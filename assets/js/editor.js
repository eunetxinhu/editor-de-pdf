/* ============================================================
   Editor visual de páginas: usado por Assinar, Editar e Recortar.
   Os itens guardam posição em pontos "visuais" (origem no canto
   superior esquerdo da página como aparece na tela).
   ============================================================ */
'use strict';

const FONT_CSS = {
    helv: 'Helvetica, Arial, sans-serif',
    times: '"Times New Roman", Times, serif',
    courier: '"Courier New", Courier, monospace',
};

class PageEditor {
    /**
     * opts.mode: 'items' | 'crop'
     * opts.onSelect(item|null): chamado quando a seleção muda
     */
    constructor(ctx, ws, opts = {}) {
        this.ctx = ctx;
        this.opts = opts;
        this.file = ctx.files[0];
        this.doc = this.file.doc;
        const st = ctx.state;
        st.items = st.items || [];
        st.cur = Math.min(st.cur || 0, this.doc.numPages - 1);
        st.crop = st.crop || { fx: 0.04, fy: 0.04, fw: 0.92, fh: 0.92 };
        this.sel = null;
        this.seq = st.items.length;

        this.pgLabel = h('span.pg');
        this.prevBtn = h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Página anterior', onclick: () => this.go(st.cur - 1) }, icon('left'));
        this.nextBtn = h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Próxima página', onclick: () => this.go(st.cur + 1) }, icon('right'));
        this.wrap = h('div.page-wrap');
        this.stage = h('div.editor-stage', this.wrap);
        const nav = h('div.editor-nav', this.prevBtn, this.pgLabel, this.nextBtn);
        if (opts.mode !== 'crop') {
            st.undo = st.undo || [];
            st.redo = st.redo || [];
            this.undoBtn = h('button.btn.btn-sm', { type: 'button', title: 'Desfazer (Ctrl+Z)', 'aria-label': 'Desfazer', onclick: () => this.undo() }, icon('rotL'));
            this.redoBtn = h('button.btn.btn-sm', { type: 'button', title: 'Refazer (Ctrl+Y)', 'aria-label': 'Refazer', onclick: () => this.redo() }, icon('rotR'));
            nav.append(h('span.nav-sep'), this.undoBtn, this.redoBtn);
        }
        ws.append(nav, this.stage);
        this.syncHistory();

        const ro = new ResizeObserver(debounce(() => this.renderPage(), 150));
        ro.observe(this.stage);
        ctx.cleanups.push(Object.assign(() => ro.disconnect(), { ws: true }));

        this.onKey = e => {
            if (this.opts.mode === 'crop') return;
            if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
            const mod = e.ctrlKey || e.metaKey;
            const k = e.key.toLowerCase();
            if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
            if (mod && k === 'y') { e.preventDefault(); return this.redo(); }
            if (e.key === 'Escape' && this.drawing) { this.setDrawMode(false); return; }
            if (!this.sel) return;
            if (mod && k === 'd') { e.preventDefault(); return this.duplicate(this.sel); }
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(this.sel); }
            const d = e.shiftKey ? 10 : 1;
            const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
            if (mv) { e.preventDefault(); this.touch(this.sel, 'move'); this.sel.x += mv[0]; this.sel.y += mv[1]; this.drawItems(); }
        };
        document.addEventListener('keydown', this.onKey);
        ctx.cleanups.push(Object.assign(() => document.removeEventListener('keydown', this.onKey), { ws: true }));
        ctx.state.editor = this;
        this.renderPage();
    }

    go(n) {
        const st = this.ctx.state;
        if (n < 0 || n >= this.doc.numPages) return;
        st.cur = n;
        this.select(null);
        this.renderPage();
    }

    async renderPage() {
        const st = this.ctx.state;
        const avail = Math.max(240, Math.min(this.stage.clientWidth - 32, 860));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const token = this.token = {};
        const { canvas, base } = await PDF.render(this.doc, st.cur + 1, { width: avail * dpr });
        if (token !== this.token) return;
        this.scale = avail / base.width;
        this.vw = base.width;
        this.vh = base.height;
        canvas.style.width = avail + 'px';
        canvas.style.height = (base.height * this.scale) + 'px';
        this.overlay = h('div.overlay', {
            onpointerdown: e => { if (e.target === this.overlay) this.select(null); },
        });
        this.wrap.replaceChildren(canvas, this.overlay);
        this.pgLabel.textContent = `Página ${st.cur + 1} de ${this.doc.numPages}`;
        this.prevBtn.disabled = st.cur === 0;
        this.nextBtn.disabled = st.cur >= this.doc.numPages - 1;
        this.drawItems();
        this.opts.onCrop?.();
    }

    pageSize() { return { w: this.vw, h: this.vh }; }

    /* ----- histórico (desfazer / refazer) ----- */
    copyItems() { return this.ctx.state.items.map(i => ({ ...i })); }
    /** Guarda o estado atual antes de uma alteração */
    snap() {
        const st = this.ctx.state;
        st.undo.push(this.copyItems());
        if (st.undo.length > 60) st.undo.shift();
        st.redo = [];
        this.touched = null;
        this.syncHistory();
    }
    /** Como snap(), mas só uma vez por sequência de ajustes no mesmo item (digitar, arrastar um controle) */
    touch(item, what) {
        const key = item.id + ':' + what;
        if (this.touched === key) return;
        this.snap();
        this.touched = key;
    }
    restore(from, to) {
        const st = this.ctx.state;
        if (!from.length) return;
        to.push(this.copyItems());
        st.items = from.pop();
        this.touched = null;
        this.select(null);
        this.drawItems();
        this.syncHistory();
        this.ctx.updateAction();
    }
    undo() { this.restore(this.ctx.state.undo, this.ctx.state.redo); }
    redo() { this.restore(this.ctx.state.redo, this.ctx.state.undo); }
    syncHistory() {
        if (!this.undoBtn) return;
        this.undoBtn.disabled = !this.ctx.state.undo.length;
        this.redoBtn.disabled = !this.ctx.state.redo.length;
    }

    duplicate(item) {
        const { id, ...rest } = item;
        return this.add({ ...rest, x: item.x + 12, y: item.y + 12, page: item.page });
    }

    /* ----- desenho à mão livre ----- */
    setDrawMode(on, style) {
        this.drawing = on ? { color: '#111111', width: 2, ...(this.drawing || {}), ...style } : null;
        if (on) this.select(null);
        this.drawItems();
        this.opts.onDrawMode?.(!!on);
    }
    addDrawLayer() {
        const s = this.scale;
        const layer = h('div.draw-layer');
        layer.innerHTML = `<svg width="100%" height="100%"><polyline fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const line = layer.querySelector('polyline');
        let pts = null;
        const pos = e => {
            const r = layer.getBoundingClientRect();
            return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
        };
        layer.addEventListener('pointerdown', e => {
            e.preventDefault();
            layer.setPointerCapture(e.pointerId);
            pts = [pos(e)];
            line.setAttribute('stroke', this.drawing.color);
            line.setAttribute('stroke-width', this.drawing.width * s);
        });
        layer.addEventListener('pointermove', e => {
            if (!pts) return;
            const p = pos(e), last = pts[pts.length - 1];
            if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.2) return;
            pts.push(p);
            line.setAttribute('points', pts.map(q => `${q[0] * s},${q[1] * s}`).join(' '));
        });
        const end = () => {
            if (!pts) return;
            const done = pts;
            pts = null;
            line.setAttribute('points', '');
            this.add(pathItem([done], this.drawing.color, this.drawing.width), { select: false });
        };
        layer.addEventListener('pointerup', end);
        layer.addEventListener('pointercancel', end);
        this.overlay.append(layer);
    }

    add(item, { select = true } = {}) {
        const st = this.ctx.state;
        this.snap();
        item.id = 'i' + (++this.seq);
        item.page = item.page ?? st.cur;
        // não deixa um item novo nascer exatamente em cima de outro
        while (st.items.some(i => i.page === item.page && Math.abs(i.x - item.x) < 2 && Math.abs(i.y - item.y) < 2)) {
            item.x += 14; item.y += 14;
        }
        st.items.push(item);
        if (select && this.drawing) { this.drawing = null; this.opts.onDrawMode?.(false); }
        if (select) this.select(item);
        this.drawItems();
        this.ctx.updateAction();
        return item;
    }

    remove(item) {
        const st = this.ctx.state;
        this.snap();
        st.items = st.items.filter(i => i !== item);
        if (this.sel === item) this.select(null);
        this.drawItems();
        this.ctx.updateAction();
    }

    /** Copia o item selecionado para todas as outras páginas */
    repeatAll(item) {
        const st = this.ctx.state;
        this.snap();
        for (let p = 0; p < this.doc.numPages; p++) {
            if (p === item.page) continue;
            const { id, ...rest } = item;
            st.items.push({ ...rest, id: 'i' + (++this.seq), page: p });
        }
        toast(`Item copiado para as ${this.doc.numPages} páginas.`);
        this.ctx.updateAction();
    }

    select(item) {
        this.sel = item;
        this.touched = null;
        $$('.item', this.overlay || document.createElement('div')).forEach(el => el.classList.toggle('sel', el.dataset.id === item?.id));
        this.opts.onSelect?.(item);
    }

    drawItems() {
        if (!this.overlay) return;
        const st = this.ctx.state;
        const s = this.scale;
        this.overlay.replaceChildren();
        if (this.opts.mode === 'crop') return this.drawCrop();

        for (const it of st.items.filter(i => i.page === st.cur)) {
            const el = h('div.item', { 'data-id': it.id });
            if (it === this.sel) el.classList.add('sel');
            el.style.left = it.x * s + 'px';
            el.style.top = it.y * s + 'px';
            if (it.type === 'image') {
                el.style.width = it.w * s + 'px';
                el.style.height = it.h * s + 'px';
                el.append(h('img', { src: it.src, alt: '' }));
            } else if (it.type === 'rect') {
                el.style.width = it.w * s + 'px';
                el.style.height = it.h * s + 'px';
                el.style.background = it.fill;
                el.style.opacity = it.opacity;
                if (it.fill.toLowerCase() === '#ffffff') el.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,.15)';
            } else if (it.type === 'path') {
                el.style.width = it.w * s + 'px';
                el.style.height = it.h * s + 'px';
                el.innerHTML = `<svg viewBox="0 0 ${it.w} ${it.h}" preserveAspectRatio="none" overflow="visible">${it.lines.map(l =>
                    `<polyline points="${l.map(q => `${q[0] * it.w},${q[1] * it.h}`).join(' ')}" fill="none" stroke="${it.color}" stroke-width="${it.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
            } else if (it.type === 'text') {
                const txt = h('div.txt', {
                    contenteditable: 'true', spellcheck: 'false',
                    style: {
                        fontSize: it.size * s + 'px', color: it.color, fontFamily: FONT_CSS[it.font],
                        fontWeight: it.bold ? '700' : '400',
                    },
                    oninput: e => { this.touch(it, 'text'); it.text = e.target.innerText.replace(/\n$/, ''); },
                    onfocus: () => { if (this.sel !== it) this.select(it); },
                });
                txt.innerText = it.text;
                el.append(txt);
            }
            el.append(
                h('span.grip', { title: 'Mover' }, icon('move')),
                h('button.rm', { type: 'button', title: 'Excluir', 'aria-label': 'Excluir', onclick: () => this.remove(it) }, icon('x')),
                h('span.rs', { title: 'Redimensionar' }, icon('resize')));
            this.bindDrag(el, it);
            this.overlay.append(el);
        }
        if (this.drawing) this.addDrawLayer();
    }

    bindDrag(el, it) {
        el.addEventListener('pointerdown', e => {
            if (e.target.closest('.rm')) return;
            const isText = it.type === 'text';
            const onText = e.target.closest('.txt');
            const resize = !!e.target.closest('.rs');
            // num texto já selecionado, clicar no texto é para editar
            if (onText && this.sel === it) return;
            e.preventDefault();
            if (this.sel !== it) this.select(it);
            const start = { x: e.clientX, y: e.clientY, ix: it.x, iy: it.y, w: it.w, h: it.h, size: it.size };
            let moved = false;
            el.setPointerCapture(e.pointerId);
            const move = ev => {
                const dx = (ev.clientX - start.x) / this.scale, dy = (ev.clientY - start.y) / this.scale;
                if (Math.abs(dx) + Math.abs(dy) > 1) {
                    if (!moved && it.type !== 'crop') this.snap();
                    moved = true;
                }
                if (!moved) return;
                if (resize) {
                    if (isText) {
                        it.size = Math.max(4, Math.round(start.size * (1 + dx / Math.max(20, el.offsetWidth / this.scale)) * 2) / 2);
                        el.querySelector('.txt').style.fontSize = it.size * this.scale + 'px';
                    } else if (it.type === 'crop') {
                        this.resizeCrop(start, dx, dy);
                    } else {
                        let w = Math.max(8, start.w + dx);
                        let hh = it.type === 'image' && !ev.shiftKey ? w * start.h / start.w : Math.max(6, start.h + dy);
                        it.w = w; it.h = hh;
                        el.style.width = w * this.scale + 'px';
                        el.style.height = hh * this.scale + 'px';
                    }
                } else if (it.type === 'crop') {
                    this.moveCrop(start, dx, dy);
                } else {
                    it.x = start.ix + dx; it.y = start.iy + dy;
                    el.style.left = it.x * this.scale + 'px';
                    el.style.top = it.y * this.scale + 'px';
                }
            };
            const up = () => {
                el.removeEventListener('pointermove', move);
                el.removeEventListener('pointerup', up);
                el.removeEventListener('pointercancel', up);
                if (it.type === 'crop') this.drawItems();
                if (isText && !moved && !resize) el.querySelector('.txt')?.focus();
                this.opts.onSelect?.(it);
            };
            el.addEventListener('pointermove', move);
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        });
    }

    /* ----- recorte ----- */
    drawCrop() {
        const c = this.ctx.state.crop;
        const s = this.scale, W = this.vw * s, H = this.vh * s; // eslint-disable-line no-unused-vars
        const x = c.fx * W, y = c.fy * H, w = c.fw * W, hh = c.fh * H;
        this.overlay.style.overflow = 'hidden';
        const it = { type: 'crop', id: 'crop' };
        const el = h('div.item.crop', { style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' } },
            h('span.rs', { title: 'Redimensionar' }, icon('resize')));
        this.cropEl = el;
        this.bindDrag(el, it);
        this.overlay.append(el);
    }
    moveCrop(start, dx, dy) {
        const c = this.ctx.state.crop;
        if (!start.crop) start.crop = { ...c };
        c.fx = Math.min(1 - c.fw, Math.max(0, start.crop.fx + dx / this.vw));
        c.fy = Math.min(1 - c.fh, Math.max(0, start.crop.fy + dy / this.vh));
        this.cropEl.style.left = c.fx * this.vw * this.scale + 'px';
        this.cropEl.style.top = c.fy * this.vh * this.scale + 'px';
        this.opts.onCrop?.();
    }
    resizeCrop(start, dx, dy) {
        const c = this.ctx.state.crop;
        if (!start.crop) start.crop = { ...c };
        c.fw = Math.min(1 - c.fx, Math.max(0.05, start.crop.fw + dx / this.vw));
        c.fh = Math.min(1 - c.fy, Math.max(0.05, start.crop.fh + dy / this.vh));
        this.cropEl.style.width = c.fw * this.vw * this.scale + 'px';
        this.cropEl.style.height = c.fh * this.vh * this.scale + 'px';
        this.opts.onCrop?.();
    }
}

/** Cria um item de traço a partir de linhas em pontos da página; guarda os pontos relativos à caixa */
function pathItem(lines, color, width) {
    const all = lines.flat();
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    const w = Math.max(2, Math.max(...xs) - x), hh = Math.max(2, Math.max(...ys) - y);
    return { type: 'path', x, y, w, h: hh, color, width, lines: lines.map(l => l.map(p => [(p[0] - x) / w, (p[1] - y) / hh])) };
}

/** Marcas prontas para preencher formulários (pontos de 0 a 1 dentro da caixa) */
const MARKS = {
    check: [[[0.04, 0.55], [0.36, 0.92], [0.96, 0.08]]],
    cross: [[[0.06, 0.06], [0.94, 0.94]], [[0.94, 0.06], [0.06, 0.94]]],
};

/** Grava os itens (textos, imagens, formas e traços) no documento pdf-lib */
async function applyEditorItems(doc, items) {
    const { StandardFonts, degrees } = PDFLib;
    const pages = doc.getPages();
    const fonts = {};
    const fontKey = (f, b) => ({
        helv: b ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
        times: b ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman,
        courier: b ? StandardFonts.CourierBold : StandardFonts.Courier,
    })[f];
    const imgs = {};
    for (const it of items) {
        const page = pages[it.page];
        if (!page) continue;
        const g = PDF.geom(page);
        const rotate = degrees(g.rot);
        if (it.type === 'image') {
            if (!imgs[it.src]) {
                const bytes = await (await fetch(it.src)).arrayBuffer();
                imgs[it.src] = it.src.startsWith('data:image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
            }
            const p = g.toPdf(it.x, it.y + it.h);
            page.drawImage(imgs[it.src], { x: p.x, y: p.y, width: it.w, height: it.h, rotate, opacity: it.opacity ?? 1 });
        } else if (it.type === 'rect') {
            const p = g.toPdf(it.x, it.y + it.h);
            page.drawRectangle({ x: p.x, y: p.y, width: it.w, height: it.h, color: PDF.hexToRgb(it.fill), opacity: it.opacity, rotate });
        } else if (it.type === 'text') {
            const key = fontKey(it.font, it.bold);
            fonts[key] = fonts[key] || await doc.embedFont(key);
            const font = fonts[key];
            String(it.text || '').split('\n').forEach((line, i) => {
                if (!line.trim()) return;
                const p = g.toPdf(it.x, it.y + it.size * 0.95 + i * it.size * 1.2);
                page.drawText(PDF.safeText(font, line), { x: p.x, y: p.y, size: it.size, font, color: PDF.hexToRgb(it.color), rotate });
            });
        } else if (it.type === 'path') {
            const color = PDF.hexToRgb(it.color);
            const at = q => g.toPdf(it.x + q[0] * it.w, it.y + q[1] * it.h);
            for (const l of it.lines) {
                if (l.length === 1) {
                    const c = at(l[0]);
                    page.drawCircle({ x: c.x, y: c.y, size: it.width / 2, color });
                }
                for (let i = 1; i < l.length; i++) {
                    page.drawLine({ start: at(l[i - 1]), end: at(l[i]), thickness: it.width, color, lineCap: PDFLib.LineCapStyle.Round });
                }
            }
        }
    }
}

/* ---------- janela para criar assinatura ---------- */
function openSignatureModal(onDone) {
    const root = $('#modal-root');
    let tab = 'draw', color = '#111111', typedFont = 'Caveat', typed = '';
    const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);

    const pad = h('canvas.sig-pad');
    let drawing = false, last = null, hasInk = false;
    const ctx2 = () => pad.getContext('2d');
    const setupPad = () => {
        const r = pad.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        pad.width = r.width * dpr; pad.height = r.height * dpr;
        const c = ctx2(); c.scale(dpr, dpr); c.lineCap = 'round'; c.lineJoin = 'round';
        hasInk = false;
    };
    pad.addEventListener('pointerdown', e => {
        drawing = true; pad.setPointerCapture(e.pointerId);
        const r = pad.getBoundingClientRect();
        last = { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
        const c = ctx2(); c.fillStyle = color; c.beginPath(); c.arc(last.x, last.y, 1.3, 0, Math.PI * 2); c.fill();
        hasInk = true;
    });
    pad.addEventListener('pointermove', e => {
        if (!drawing) return;
        const r = pad.getBoundingClientRect();
        const p = { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
        const speed = Math.hypot(p.x - last.x, p.y - last.y) / Math.max(1, p.t - last.t);
        const c = ctx2();
        c.strokeStyle = color;
        c.lineWidth = Math.max(1.4, 3.4 - speed * 1.2);
        c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(p.x, p.y); c.stroke();
        last = p;
    });
    const stop = () => drawing = false;
    pad.addEventListener('pointerup', stop);
    pad.addEventListener('pointercancel', stop);

    const typedInput = h('input.input', { type: 'text', placeholder: 'Digite seu nome', oninput: e => { typed = e.target.value; drawTyped(); } });
    const typedList = h('div', { style: { display: 'grid', gap: '8px', marginTop: '10px' } });
    const fonts = ['Caveat', 'Dancing Script', 'Homemade Apple'];
    const drawTyped = () => {
        typedList.replaceChildren(...fonts.map(f => h('button.sig-typed', {
            type: 'button', 'aria-pressed': String(f === typedFont),
            style: { fontFamily: `"${f}", cursive`, color, fontSize: f === 'Homemade Apple' ? '1.5rem' : '2rem' },
            onclick: () => { typedFont = f; drawTyped(); },
        }, typed || 'Seu nome')));
    };

    let uploaded = null;
    const upPreview = h('div', { style: { minHeight: '120px', display: 'grid', placeItems: 'center', background: '#fff', border: '1px solid var(--rule)', borderRadius: '6px' } }, h('span.hint', 'Nenhuma imagem escolhida'));
    const upInput = h('input', {
        type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true,
        onchange: async e => {
            const f = e.target.files[0];
            if (!f) return;
            const bmp = await loadImageBitmap(f);
            const c = h('canvas', { width: bmp.width, height: bmp.height });
            c.getContext('2d').drawImage(bmp, 0, 0);
            uploaded = c;
            upPreview.replaceChildren(h('img', { src: c.toDataURL(), style: { maxWidth: '100%', maxHeight: '160px' } }));
        },
    });

    const panes = {
        draw: h('div', pad, h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' } },
            h('span.hint', 'Desenhe com o mouse ou o dedo'),
            h('button.btn.btn-sm', { type: 'button', onclick: setupPad }, 'Limpar'))),
        type: h('div', typedInput, typedList),
        upload: h('div', upPreview, h('div', { style: { marginTop: '8px' } },
            h('button.btn.btn-sm', { type: 'button', onclick: () => upInput.click() }, 'Escolher imagem'), upInput,
            h('p.hint', { style: { margin: '6px 0 0' } }, 'Dica: uma foto da assinatura em papel branco funciona bem; o fundo branco é removido.'))),
    };
    const tabs = h('div.tabs', { role: 'tablist' });
    const drawTabs = () => {
        tabs.replaceChildren(...[['draw', 'Desenhar'], ['type', 'Digitar'], ['upload', 'Imagem']].map(([k, label]) =>
            h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; drawTabs(); } }, label)));
        Object.entries(panes).forEach(([k, el]) => el.hidden = k !== tab);
        if (tab === 'draw') requestAnimationFrame(setupPad);
        if (tab === 'type') { drawTyped(); typedInput.focus(); }
    };
    const swatches = h('div.swatches', h('span.hint', 'Cor:'),
        ['#111111', '#1d3fb8', '#0b5d1e'].map(c => h('button.swatch', {
            type: 'button', 'aria-label': 'Cor ' + c, 'aria-pressed': String(c === color), style: { background: c },
            onclick: e => { color = c; $$('.swatch', swatches).forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); if (tab === 'type') drawTyped(); },
        })));

    const finish = async () => {
        let canvas;
        if (tab === 'draw') {
            if (!hasInk) return toast('Desenhe sua assinatura primeiro.', 'error');
            canvas = pad;
        } else if (tab === 'type') {
            if (!typed.trim()) return toast('Digite seu nome primeiro.', 'error');
            await document.fonts.load(`80px "${typedFont}"`);
            canvas = document.createElement('canvas');
            const c = canvas.getContext('2d');
            c.font = `80px "${typedFont}", cursive`;
            const w = Math.ceil(c.measureText(typed).width) + 60;
            canvas.width = w; canvas.height = 180;
            c.font = `80px "${typedFont}", cursive`;
            c.fillStyle = color;
            c.textBaseline = 'middle';
            c.fillText(typed, 30, 95);
        } else {
            if (!uploaded) return toast('Escolha uma imagem primeiro.', 'error');
            canvas = removeWhiteBackground(uploaded);
        }
        const trimmed = trimCanvas(canvas);
        if (!trimmed) return toast('A assinatura ficou vazia.', 'error');
        close();
        onDone({ src: trimmed.toDataURL('image/png'), w: trimmed.width, h: trimmed.height });
    };

    root.append(h('div.modal-bg', { onclick: e => { if (e.target.classList.contains('modal-bg')) close(); } },
        h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Criar assinatura', style: { '--c': 'var(--accent)' } },
            h('h2', 'Criar assinatura'),
            tabs,
            panes.draw, panes.type, panes.upload,
            h('div', { style: { marginTop: '12px' } }, swatches),
            h('div.modal-actions',
                h('button.btn', { type: 'button', onclick: close }, 'Cancelar'),
                h('button.btn.btn-primary', { type: 'button', onclick: finish }, 'Usar assinatura')))));
    drawTabs();
}

/** Corta as bordas transparentes de um canvas */
function trimCanvas(src) {
    const c = src.getContext('2d');
    const { width: w, height: hh } = src;
    const data = c.getImageData(0, 0, w, hh).data;
    let x0 = w, y0 = hh, x1 = -1, y1 = -1;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 10) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    }
    if (x1 < 0) return null;
    const pad = 6;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(hh - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
}

/** Deixa transparente o fundo claro de uma foto de assinatura */
function removeWhiteBackground(src) {
    const out = h('canvas', { width: src.width, height: src.height });
    const c = out.getContext('2d');
    c.drawImage(src, 0, 0);
    const img = c.getImageData(0, 0, out.width, out.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (lum > 200) d[i + 3] = 0;
        else if (lum > 150) d[i + 3] = Math.round(d[i + 3] * (200 - lum) / 50);
    }
    c.putImageData(img, 0, 0);
    return out;
}
