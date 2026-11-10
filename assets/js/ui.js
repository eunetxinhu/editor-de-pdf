/* ============================================================
   Interface: rotas, tela inicial, página de ferramenta,
   lista de arquivos, grade de páginas e tela de resultado.
   ============================================================ */
'use strict';

const ACCEPT = {
    pdf: { mime: 'application/pdf,.pdf', label: 'PDF', test: isPdf },
    image: { mime: 'image/*', label: 'imagens (JPG, PNG, WEBP)', test: isImage },
    'pdf+image': { mime: 'application/pdf,.pdf,image/*', label: 'PDFs ou imagens', test: f => isPdf(f) || isImage(f) },
    docx: { mime: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'documento Word (.docx)', test: isDocx },
};

/* ---------- tema ---------- */
function setupTheme() {
    const btn = $('#theme-toggle');
    btn.addEventListener('click', () => {
        const root = document.documentElement;
        const dark = root.dataset.theme
            ? root.dataset.theme === 'dark'
            : matchMedia('(prefers-color-scheme: dark)').matches;
        const apply = () => {
            root.dataset.theme = dark ? 'light' : 'dark';
            try { localStorage.setItem('tema', root.dataset.theme); } catch (e) {}
        };
        if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return apply();
        // o novo tema "cresce" em círculo a partir do botão
        const r = btn.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        document.startViewTransition(apply).ready.then(() => {
            root.animate(
                { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
                { duration: 600, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' });
        });
    });
}

/** Marca no menu em pílula o atalho da página atual */
function updatePillNav(id) {
    $$('#pillnav a').forEach(a => {
        const target = a.getAttribute('href').replace(/^#\/?/, '');
        if (target === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
}

/* ---------- rotas ---------- */
App.pendingFiles = null;
App.openTool = function (id, files) {
    App.pendingFiles = files || null;
    if (location.hash === '#/' + id) App.route(); else location.hash = '#/' + id;
};
App.route = function () {
    const id = location.hash.replace(/^#\/?/, '');
    const tool = App.tool(id);
    updatePillNav(tool ? id : '');
    const main = $('#app');
    main.innerHTML = '';
    App.current?.destroy?.();
    App.current = null;
    if (tool) {
        document.title = tool.title + ' — Editor de PDF';
        App.current = new ToolPage(tool, main, App.pendingFiles);
        App.pendingFiles = null;
    } else {
        document.title = 'Editor de PDF';
        renderHome(main);
    }
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
};
App.start = function () {
    setupTheme();
    window.addEventListener('hashchange', App.route);
    App.route();
};

function catColor(cat) { return `var(--c-${cat})`; }
function toolIcon(tool) {
    const s = icon(tool.icon);
    return h('span.tile-icon', s);
}

/* ---------- tela inicial ---------- */
let homeFilter = { cat: null, q: '' };
const plain = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function kpiIcon(paths) { return h('span.kpi-ico', icon(paths)); }

function renderHome(main) {
    const grid = h('div');
    const search = h('input', {
        type: 'search', placeholder: 'Buscar ferramenta', 'aria-label': 'Buscar ferramenta',
        value: homeFilter.q,
        oninput: e => { homeFilter.q = e.target.value; draw(); },
    });
    const chips = h('div.chips', { role: 'group', 'aria-label': 'Filtrar por categoria' });

    function drawChips() {
        chips.innerHTML = '';
        chips.append(h('button.chip', {
            type: 'button', 'aria-pressed': String(!homeFilter.cat),
            onclick: () => { homeFilter.cat = null; draw(); },
        }, 'Todas', h('span.count', String(App.tools.length))));
        for (const c of App.categories) {
            const n = App.tools.filter(t => t.cat === c.id).length;
            chips.append(h('button.chip', {
                type: 'button', 'aria-pressed': String(homeFilter.cat === c.id),
                style: { '--cat': catColor(c.id) },
                onclick: () => { homeFilter.cat = homeFilter.cat === c.id ? null : c.id; draw(); },
            }, h('span.dot'), c.name, h('span.count', String(n))));
        }
    }

    function draw() {
        drawChips();
        grid.innerHTML = '';
        const q = plain(homeFilter.q.trim());
        const match = t => !q || plain(t.title + ' ' + t.desc + ' ' + (t.keywords || '')).includes(q);
        let count = 0;
        for (const c of App.categories) {
            if (homeFilter.cat && homeFilter.cat !== c.id) continue;
            const tools = App.tools.filter(t => t.cat === c.id && match(t));
            if (!tools.length) continue;
            count += tools.length;
            grid.append(h('section.cat-block',
                h('h2.cat-title', c.name, h('span.count', String(tools.length))),
                h('div.tiles', tools.map(t =>
                    h('a.tile', { href: '#/' + t.id, style: { '--cat': catColor(t.cat) } },
                        h('span.go', icon('<path d="M5 12h14M13 6l6 6-6 6"/>')),
                        toolIcon(t), h('h3', t.title), h('p', t.desc))))));
        }
        if (!count) grid.append(h('p.empty-search', 'Nenhuma ferramenta encontrada para essa busca.'));
    }

    const cats = new Set(App.tools.map(t => t.cat)).size;
    main.append(h('div.home',
        h('div.page-title',
            h('div',
                h('h1', 'Ferramentas de PDF'),
                h('p', 'Junte, divida, comprima, converta, assine e proteja seus documentos.')),
            h('div.search', icon('search'), search)),
        h('section.kpis', { 'aria-label': 'Resumo' },
            h('div.kpi.featured',
                h('div.kpi-top', kpiIcon('<path d="M12 3 5 6v5c0 4.5 3 8.4 7 9.6 4-1.2 7-5.1 7-9.6V6z"/><path d="m9 12 2 2 4-4"/>'), 'Privacidade total'),
                h('div', h('div.kpi-value', 'Seus arquivos não saem daqui'),
                    h('div.kpi-label', 'Tudo é processado no seu navegador, sem upload.'))),
            h('div.kpi', { style: { '--k': 'var(--c-organizar)' } },
                h('div.kpi-top', kpiIcon('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'), 'Ferramentas'),
                h('div', h('div.kpi-value', String(App.tools.length)), h('div.kpi-label', 'prontas para usar'))),
            h('div.kpi', { style: { '--k': 'var(--c-editar)' } },
                h('div.kpi-top', kpiIcon('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'), 'Categorias'),
                h('div', h('div.kpi-value', String(cats)), h('div.kpi-label', 'de organizar a proteger'))),
            h('div.kpi', { style: { '--k': 'var(--c-otimizar)' } },
                h('div.kpi-top', kpiIcon('<path d="M7 18a5 5 0 0 1-.9-9.9A6 6 0 0 1 17.7 9 4.5 4.5 0 0 1 18 18"/><path d="M4 4l16 16"/>'), 'Enviado a servidores'),
                h('div', h('div.kpi-value', '0 MB'), h('div.kpi-label', 'funciona até sem conta')))),
        h('div.segmented', chips),
        grid));
    draw();
}

/* ---------- arrastar para reordenar (mouse e toque) ---------- */
function makeSortable(container, { item, onEnd }) {
    let drag = null;
    let suppressClick = false;

    container.addEventListener('pointerdown', e => {
        const el = e.target.closest(item);
        if (!el || !container.contains(el) || e.button !== 0) return;
        if (e.pointerType !== 'mouse' && !e.target.closest('.drag-handle')) return;
        if (e.pointerType === 'mouse' && e.target.closest('button, input, select, a, [contenteditable]')) return;
        drag = { el, x: e.clientX, y: e.clientY, started: false, id: e.pointerId };
    });

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    function onMove(e) {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.started) {
            if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
            drag.started = true;
            const r = drag.el.getBoundingClientRect();
            const ghost = drag.el.cloneNode(true);
            // canvas clonado vem em branco: copia o desenho
            const src = $$('canvas', drag.el), dst = $$('canvas', ghost);
            dst.forEach((c, i) => c.getContext('2d').drawImage(src[i], 0, 0));
            ghost.classList.add('dragging-ghost');
            ghost.style.width = r.width + 'px';
            ghost.style.height = r.height + 'px';
            document.body.append(ghost);
            drag.ghost = ghost;
            drag.dx = drag.x - r.left;
            drag.dy = drag.y - r.top;
            drag.el.classList.add('drag-placeholder');
        }
        e.preventDefault();
        drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
        drag.ghost.style.top = (e.clientY - drag.dy) + 'px';

        const under = document.elementFromPoint(e.clientX, e.clientY)?.closest(item);
        if (under && under !== drag.el && container.contains(under)) {
            const r = under.getBoundingClientRect();
            const sameRow = Math.abs(r.top - drag.el.getBoundingClientRect().top) < r.height / 2;
            const after = sameRow ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
            const ref = after ? under.nextSibling : under;
            if (ref !== drag.el) container.insertBefore(drag.el, ref);
        }
        // rolagem automática perto das bordas
        if (e.clientY < 70) window.scrollBy(0, -12);
        else if (e.clientY > innerHeight - 70) window.scrollBy(0, 12);
    }

    function onUp(e) {
        if (!drag || e.pointerId !== drag.id) return;
        if (drag.started) {
            drag.ghost.remove();
            drag.el.classList.remove('drag-placeholder');
            suppressClick = true;
            setTimeout(() => suppressClick = false, 50);
            onEnd($$(item, container).map(el => el.dataset.key));
        }
        drag = null;
    }

    container.addEventListener('click', e => {
        if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    return () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
    };
}

/* ---------- campos reutilizáveis para os painéis ---------- */
const F = {
    field(label, control, hint) {
        return h('div.field', h('label', label), control, hint && h('span.hint', hint));
    },
    choices(name, options, value, onChange, inline = false) {
        return h('div.choices' + (inline ? '.inline' : ''), { role: 'radiogroup' },
            options.map(o => h('label.choice',
                h('input', {
                    type: 'radio', name, value: o.value, checked: o.value === value,
                    onchange: () => onChange(o.value),
                }),
                h('span.mark'),
                h('span', h('b', o.label), o.hint && h('small', o.hint)))));
    },
    select(options, value, onChange) {
        return h('select.input', { onchange: e => onChange(e.target.value) },
            options.map(o => h('option', { value: o.value, selected: o.value === value }, o.label)));
    },
    text(value, onInput, attrs = {}) {
        return h('input.input', { type: 'text', value, oninput: e => onInput(e.target.value), ...attrs });
    },
    number(value, onInput, attrs = {}) {
        return h('input.input', { type: 'number', value, oninput: e => onInput(+e.target.value), ...attrs });
    },
    check(label, checked, onChange) {
        return h('label.check', h('input', { type: 'checkbox', checked, onchange: e => onChange(e.target.checked) }), h('span', label));
    },
    range(value, min, max, step, onInput, fmt = v => v) {
        const out = h('span.hint', fmt(value));
        const input = h('input', {
            type: 'range', min, max, step, value,
            oninput: e => { out.textContent = fmt(+e.target.value); onInput(+e.target.value); },
        });
        return h('div', input, out);
    },
    color(value, onInput) {
        return h('input', { type: 'color', value, oninput: e => onInput(e.target.value) });
    },
    /** Grade 3x3 de posições: 'tl','tc','tr','ml','mc','mr','bl','bc','br' */
    position(value, onChange, allowed) {
        const keys = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
        const names = {
            tl: 'Superior esquerdo', tc: 'Superior centro', tr: 'Superior direito',
            ml: 'Meio esquerdo', mc: 'Centro', mr: 'Meio direito',
            bl: 'Inferior esquerdo', bc: 'Inferior centro', br: 'Inferior direito',
        };
        const grid = h('div.pos-grid', { role: 'group' });
        const draw = () => {
            grid.innerHTML = '';
            keys.forEach(k => grid.append(h('button', {
                type: 'button', title: names[k], 'aria-label': names[k],
                'aria-pressed': String(k === value),
                disabled: allowed && !allowed.includes(k),
                onclick: () => { value = k; draw(); onChange(k); },
            })));
        };
        draw();
        return grid;
    },
    note(...content) { return h('div.note', ...content); },
};

/* ---------- página de ferramenta ---------- */
class ToolPage {
    constructor(tool, main, initialFiles) {
        this.tool = tool;
        this.main = main;
        this.files = [];     // { key, file, bytes, doc (pdf.js), pageCount, color }
        this.pages = [];     // usado nas grades de páginas
        this.opts = typeof tool.defaults === 'function' ? tool.defaults() : { ...(tool.defaults || {}) };
        this.busy = false;
        this.cleanups = [];
        this.keySeq = 0;
        this.state = {};     // estado livre da ferramenta

        this.input = h('input', {
            type: 'file', hidden: true,
            accept: ACCEPT[tool.accept].mime,
            multiple: !!tool.multiple || !!tool.addMore,
            onchange: e => { this.addFiles(e.target.files); e.target.value = ''; },
        });

        this.root = h('div.tool', { style: { '--c': 'var(--accent)', '--cat': catColor(tool.cat) } },
            h('a.back', { href: '#/' }, icon('back'), 'Todas as ferramentas'),
            h('div.tool-head', toolIcon(tool), h('div', h('h1', tool.title), h('p', tool.longDesc || tool.desc))),
            this.body = h('div.tool-body'),
            this.input);
        main.append(this.root);

        // arrastar arquivos sobre a página inteira
        const over = e => { e.preventDefault(); this.root.querySelector('.drop')?.classList.add('over'); };
        const leave = () => this.root.querySelector('.drop')?.classList.remove('over');
        const drop = e => {
            e.preventDefault(); leave();
            if (e.dataTransfer?.files?.length && !this.busy && !this.done) this.addFiles(e.dataTransfer.files);
        };
        // colar arquivos ou prints com Ctrl+V
        const paste = e => {
            const files = Array.from(e.clipboardData?.files || []);
            if (!files.length || this.busy || this.done) return;
            if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
            e.preventDefault();
            this.addFiles(files.map(f => f.name && f.name !== 'image.png' ? f
                : new File([f], `colado-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`, { type: f.type })));
        };
        document.addEventListener('paste', paste);
        document.addEventListener('dragover', over);
        document.addEventListener('dragleave', leave);
        document.addEventListener('drop', drop);
        this.cleanups.push(() => {
            document.removeEventListener('paste', paste);
            document.removeEventListener('dragover', over);
            document.removeEventListener('dragleave', leave);
            document.removeEventListener('drop', drop);
        });

        if (initialFiles?.length) this.addFiles(initialFiles);
        else this.render();
    }

    destroy() {
        this.cleanups.forEach(f => f());
        this.tool.destroy?.(this);
        // espera miniaturas em andamento terminarem antes de liberar a memória
        const docs = this.files.map(f => f.doc).filter(Boolean);
        setTimeout(() => docs.forEach(d => d.destroy()), 5000);
    }

    pick() { this.input.click(); }

    async addFiles(list) {
        const acc = ACCEPT[this.tool.accept];
        let arr = Array.from(list);
        const bad = arr.filter(f => !acc.test(f));
        arr = arr.filter(f => acc.test(f));
        if (bad.length) toast(`Arquivo ignorado: envie apenas ${acc.label}.`, 'error');
        if (!arr.length) return;
        const multi = this.tool.multiple || this.tool.addMore;
        if (!multi) {
            this.files.forEach(f => f.doc?.destroy?.());
            this.files = [];
            this.pages = [];
            arr = arr.slice(0, 1);
        }
        const palette = ['#2546c7', '#c2501d', '#0e7f5f', '#7b3fbf', '#a0750a', '#b3263e', '#3f5d73'];
        this.showLoading('Lendo arquivos...');
        for (const file of arr) {
            const entry = { key: 'f' + (++this.keySeq), file, color: palette[this.keySeq % palette.length] };
            try {
                entry.bytes = await file.arrayBuffer();
                if (isPdf(file) && !this.tool.skipPdfOpen) {
                    entry.doc = await PDF.open(entry.bytes);
                    entry.pageCount = entry.doc.numPages;
                }
                this.files.push(entry);
            } catch (e) {
                if (this.tool.keepUnreadable && isPdf(file) && entry.bytes) {
                    entry.unreadable = true;
                    entry.locked = /senha/.test(e.message);
                    this.files.push(entry);
                } else {
                    toast(`${file.name}: ${e.message}`, 'error');
                }
            }
        }
        if (this.tool.view === 'pages' || this.tool.view === 'editor') this.buildPages();
        await this.tool.onFiles?.(this);
        this.render();
    }

    removeFile(key) {
        const f = this.files.find(f => f.key === key);
        f?.doc?.destroy?.();
        this.files = this.files.filter(f => f.key !== key);
        this.pages = this.pages.filter(p => p.file !== f);
        this.tool.onFiles?.(this);
        this.render();
    }

    buildPages() {
        const existing = new Set(this.pages.map(p => p.file));
        for (const f of this.files) {
            if (existing.has(f)) continue;
            // uma imagem vira uma página
            if (!f.pageCount && isImage(f.file)) {
                this.pages.push({ key: 'p' + (++this.keySeq), file: f, index: 0, rot: 0, sel: false, image: true });
                continue;
            }
            if (!f.pageCount) continue;
            for (let i = 0; i < f.pageCount; i++) {
                this.pages.push({ key: 'p' + (++this.keySeq), file: f, index: i, rot: 0, sel: false });
            }
        }
    }

    showLoading(text) {
        this.body.className = 'tool-body no-files';
        this.body.innerHTML = '';
        this.body.append(h('div.workspace', h('div.loading-block', h('span.spinner'), text)));
    }

    render() {
        if (this.done) return;
        this.body.innerHTML = '';
        if (!this.files.length) {
            this.body.className = 'tool-body no-files';
            const acc = ACCEPT[this.tool.accept];
            this.body.append(h('div.drop', {
                role: 'button', tabindex: 0,
                onclick: () => this.pick(),
                onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pick(); } },
            },
                icon('upload'),
                h('strong', this.tool.multiple ? `Selecione os arquivos (${acc.label})` : `Selecione o arquivo (${acc.label})`),
                h('span', 'ou arraste e solte aqui · Ctrl+V também funciona'),
                h('div', h('span.btn.btn-primary', 'Escolher ' + (this.tool.multiple ? 'arquivos' : 'arquivo')))));
            return;
        }
        this.body.className = 'tool-body';
        this.workspace = h('div.workspace');
        this.panel = h('aside.panel');
        this.body.append(this.workspace, this.panel);
        this.renderWorkspace();
        this.renderPanel();
    }

    renderWorkspace() {
        const ws = this.workspace;
        ws.innerHTML = '';
        this.cleanups = this.cleanups.filter(f => !f.ws || (f(), false));
        const view = this.tool.view || 'files';
        if (view === 'files') this.renderFiles(ws);
        else if (view === 'pages') this.renderPages(ws);
        else this.tool.workspace(this, ws);
    }

    renderPanel() {
        const p = this.panel;
        p.innerHTML = '';
        p.append(h('h2', 'Opções'));
        const opts = this.tool.options?.(this);
        if (opts) p.append(opts);
        this.progressBox = h('div.progress-wrap', { hidden: true },
            h('div.progress', this.progressBar = h('div')),
            this.progressText = h('span.progress-text'));
        this.actionBtn = h('button.btn.btn-primary.btn-big', { type: 'button', onclick: () => this.execute() },
            this.tool.actionLabel || this.tool.title);
        p.append(this.progressBox, this.actionBtn);
        this.updateAction();
    }

    updateAction() {
        if (!this.actionBtn) return;
        const err = this.tool.validate?.(this);
        this.actionBtn.disabled = this.busy || !!err;
        this.actionBtn.title = err || '';
        if (this.validHint) this.validHint.remove();
        if (err && !this.busy) {
            this.validHint = h('span.hint', { style: { textAlign: 'center' } }, err);
            this.actionBtn.after(this.validHint);
        }
    }

    progress(frac, text) {
        this.progressBox.hidden = false;
        this.progressBar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
        if (text) this.progressText.textContent = text;
    }

    async execute() {
        if (this.busy) return;
        const err = this.tool.validate?.(this);
        if (err) return toast(err, 'error');
        this.busy = true;
        this.updateAction();
        this.actionBtn.replaceChildren(h('span.spinner'), 'Processando...');
        this.progress(0, 'Começando...');
        // dá tempo da interface atualizar antes do trabalho pesado
        await new Promise(r => setTimeout(r, 30));
        try {
            let out = await this.tool.run(this);
            if (!out) throw new Error('Nada foi gerado.');
            let list = Array.isArray(out) ? out : [out];
            let single = list.length === 1 ? list[0] : await zipOutputs(list, this.tool.zipName?.(this) || 'arquivos.zip');
            this.showResult(single, list);
        } catch (e) {
            console.error(e);
            toast(e.message || 'Algo deu errado ao processar o arquivo.', 'error');
            this.busy = false;
            this.progressBox.hidden = true;
            this.actionBtn.replaceChildren(this.tool.actionLabel || this.tool.title);
            this.updateAction();
        }
    }

    showResult(out, list) {
        this.done = true;
        this.busy = false;
        const outFile = new File([out.blob], out.name, { type: out.blob.type });
        const info = this.tool.resultInfo?.(this, out, list);
        const failed = batchErrorNote(this);
        const extra = info || failed ? h('span', info, info && failed ? h('br') : null, failed) : null;
        const isPdfOut = isPdf(outFile);
        const next = isPdfOut
            ? (this.tool.next || ['compress', 'merge', 'sign', 'watermark', 'page-numbers', 'protect', 'organize'])
                .filter(id => id !== this.tool.id && App.tool(id))
            : [];

        const download = () => downloadBlob(out.blob, out.name);
        this.body.className = 'tool-body no-files';
        this.body.innerHTML = '';
        this.body.append(h('div.result',
            h('div.done-ico', icon('check')),
            h('h2', this.tool.doneTitle || 'Pronto!'),
            h('p', list.length > 1 ? `${list.length} arquivos foram reunidos em um .zip.` : out.name, ' · ', formatBytes(out.blob.size)),
            extra && h('p.stats', extra),
            h('button.btn.btn-primary.btn-big', { type: 'button', onclick: download }, icon('down'), 'Baixar ' + (list.length > 1 ? 'arquivo .zip' : 'arquivo')),
            h('div.secondary',
                h('button.btn', { type: 'button', onclick: () => App.openTool(this.tool.id) }, 'Recomeçar'),
                h('a.btn', { href: '#/' }, 'Outras ferramentas')),
            next.length ? h('div.continue',
                h('h3', 'Continuar com este arquivo'),
                h('div.chips', next.map(id => {
                    const t = App.tool(id);
                    return h('button.chip', {
                        type: 'button', style: { '--cat': catColor(t.cat) },
                        onclick: () => App.openTool(id, [outFile]),
                    }, h('span.dot'), t.title);
                }))) : null));
        download();
        toast('Arquivo pronto. O download começou.');
    }

    /* ----- visão: lista de arquivos ----- */
    renderFiles(ws) {
        const multi = this.tool.multiple;
        const sortable = multi && this.tool.sortable !== false && this.files.length > 1;
        const total = this.files.reduce((s, f) => s + f.file.size, 0);
        ws.append(h('div.ws-head',
            h('span.meta', this.files.length === 1 ? '1 arquivo' : `${this.files.length} arquivos`, ' · ', formatBytes(total),
                sortable ? ' · arraste para mudar a ordem' : ''),
            h('div.actions',
                multi && this.files.length > 1 && this.tool.sortByName !== false && h('button.btn.btn-sm', {
                    type: 'button', onclick: () => {
                        this.files.sort((a, b) => a.file.name.localeCompare(b.file.name, 'pt-BR', { numeric: true }));
                        this.renderWorkspace();
                    },
                }, 'Ordenar por nome'),
                !multi && h('button.btn.btn-sm', { type: 'button', onclick: () => this.pick() }, 'Trocar arquivo'))));

        const list = h('div.file-list');
        this.files.forEach((f, i) => {
            const thumb = h('div.thumb', h('span.ph', 'carregando...'));
            const info = [];
            if (f.pageCount) info.push(f.pageCount + (f.pageCount === 1 ? ' página' : ' páginas'));
            if (f.locked) info.push('protegido por senha');
            else if (f.unreadable) info.push('sem pré-visualização');
            info.push(formatBytes(f.file.size));
            const card = h('div.file-card' + (sortable ? '.sortable' : ''), { 'data-key': f.key },
                sortable && h('span.order', String(i + 1)),
                h('div.tools',
                    sortable && h('span.mini-btn.drag-handle', { title: 'Arrastar' }, icon('move')),
                    sortable && i > 0 && h('button.mini-btn', { type: 'button', title: 'Mover para trás', 'aria-label': 'Mover para trás', onclick: () => this.moveFile(i, -1) }, icon('left')),
                    sortable && i < this.files.length - 1 && h('button.mini-btn', { type: 'button', title: 'Mover para frente', 'aria-label': 'Mover para frente', onclick: () => this.moveFile(i, 1) }, icon('right')),
                    h('button.mini-btn.del', { type: 'button', title: 'Remover', 'aria-label': 'Remover ' + f.file.name, onclick: () => this.removeFile(f.key) }, icon('x'))),
                thumb,
                h('div.name', { title: f.file.name }, f.file.name),
                h('div.info', info.join(' · ')));
            list.append(card);
            this.fillThumb(f, thumb);
        });
        if (multi) {
            list.append(h('button.add-card', { type: 'button', onclick: () => this.pick() },
                h('div', icon('plus'), 'Adicionar mais')));
        }
        ws.append(list);
        if (sortable) {
            this.cleanups.push(Object.assign(makeSortable(list, {
                item: '.file-card',
                onEnd: keys => {
                    this.files.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
                    this.renderWorkspace();
                },
            }), { ws: true }));
        }
        this.tool.afterFiles?.(this, ws);
    }

    moveFile(i, d) {
        const j = i + d;
        [this.files[i], this.files[j]] = [this.files[j], this.files[i]];
        this.renderWorkspace();
    }

    async fillThumb(f, box) {
        try {
            if (f.doc) {
                if (!f.thumb) f.thumb = (await PDF.render(f.doc, 1, { width: 220 })).canvas;
                const c = h('canvas', { width: f.thumb.width, height: f.thumb.height });
                c.getContext('2d').drawImage(f.thumb, 0, 0);
                box.replaceChildren(c);
            } else if (isImage(f.file)) {
                if (!f.url) f.url = URL.createObjectURL(f.file);
                box.replaceChildren(h('img', { src: f.url, alt: '' }));
            } else {
                box.replaceChildren(h('span.ph', icon('file'), f.locked ? 'PDF protegido' : baseName(f.file.name).slice(0, 20)));
                box.querySelector('svg')?.setAttribute('style', 'width:42px;height:42px;margin:0 auto 6px;fill:none;stroke:var(--c);stroke-width:1.6');
            }
        } catch (e) {
            box.replaceChildren(h('span.ph', 'sem prévia'));
        }
    }

    /* ----- visão: grade de páginas ----- */
    renderPages(ws) {
        const t = this.tool;
        const mode = t.pagesMode || 'view';
        const head = h('div.ws-head',
            h('span.meta', t.pagesHint?.(this) || `${this.pages.length} páginas`),
            h('div.actions', t.pagesActions?.(this) || null,
                (t.multiple || t.addMore) ? h('button.btn.btn-sm', { type: 'button', onclick: () => this.pick() }, icon('plus'), t.accept === 'pdf' ? 'Adicionar PDF' : 'Adicionar arquivos')
                    : h('button.btn.btn-sm', { type: 'button', onclick: () => this.pick() }, 'Trocar arquivo')));
        ws.append(head);

        const grid = h('div.pages');
        const io = new IntersectionObserver(entries => {
            for (const en of entries) {
                if (!en.isIntersecting) continue;
                io.unobserve(en.target);
                this.drawPageThumb(en.target._page, en.target.querySelector('.pthumb'));
            }
        }, { rootMargin: '300px' });
        this.cleanups.push(Object.assign(() => io.disconnect(), { ws: true }));

        const multiFile = new Set(this.pages.filter(p => !p.blank).map(p => p.file)).size > 1;
        this.pages.forEach((p, i) => {
            const card = h('div.page-card', { 'data-key': p.key, tabindex: mode === 'view' ? null : 0 });
            card._page = p;
            const sel = mode === 'select';
            if (sel || mode === 'rotate') card.classList.add('clickable');
            if (mode === 'organize') card.classList.add('sortable');
            if (sel && p.sel) card.classList.add(t.selectStyle === 'remove' ? 'removed' : 'selected');
            if (sel) card.append(h('span.tick', icon('check')));
            const badge = t.pageBadge?.(this, p, i);
            if (badge) card.append(h('span.badge', { style: { background: badge.color } }, badge.text));

            const tools = [];
            if (mode === 'organize' || mode === 'rotate') {
                tools.push(h('button.mini-btn', { type: 'button', title: 'Girar para a esquerda', 'aria-label': 'Girar para a esquerda', onclick: e => { e.stopPropagation(); this.rotatePage(p, card, -90); } }, icon('rotL')));
                tools.push(h('button.mini-btn', { type: 'button', title: 'Girar para a direita', 'aria-label': 'Girar para a direita', onclick: e => { e.stopPropagation(); this.rotatePage(p, card, 90); } }, icon('rotR')));
            }
            if (mode === 'organize') {
                tools.unshift(h('span.mini-btn.drag-handle', { title: 'Arrastar' }, icon('move')));
                tools.push(h('button.mini-btn', { type: 'button', title: 'Duplicar', 'aria-label': 'Duplicar página', onclick: e => { e.stopPropagation(); this.pages.splice(i + 1, 0, { ...p, key: 'p' + (++this.keySeq) }); this.refreshPages(); } }, icon('copy')));
                tools.push(h('button.mini-btn.del', { type: 'button', title: 'Excluir página', 'aria-label': 'Excluir página', onclick: e => { e.stopPropagation(); this.pages.splice(i, 1); this.refreshPages(); } }, icon('x')));
            }
            if (tools.length) card.append(h('div.ptools', tools));

            card.append(h('div.pthumb', p.blank ? h('div.blank') : h('span.ph', '')));
            card.append(h('span.pnum', multiFile && !p.blank ? h('span.file-dot', { style: { background: p.file.color } }) : null,
                p.blank ? 'Em branco' : (mode === 'organize' ? `${i + 1}` : `${p.index + 1}`)));

            const activate = () => {
                if (sel) {
                    p.sel = !p.sel;
                    card.classList.toggle(t.selectStyle === 'remove' ? 'removed' : 'selected', p.sel);
                    t.onSelect?.(this);
                    this.updateAction();
                } else if (mode === 'rotate') {
                    this.rotatePage(p, card, 90);
                }
            };
            if (sel || mode === 'rotate') {
                card.addEventListener('click', activate);
                card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
            }
            grid.append(card);
            if (!p.blank) io.observe(card);
        });
        if (mode === 'organize') {
            this.cleanups.push(Object.assign(makeSortable(grid, {
                item: '.page-card',
                onEnd: keys => {
                    this.pages.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
                    this.refreshPages();
                },
            }), { ws: true }));
        }
        ws.append(grid);
    }

    refreshPages() {
        const y = window.scrollY;
        this.renderWorkspace();
        this.tool.onSelect?.(this);
        this.updateAction();
        window.scrollTo(0, y);
    }

    rotatePage(p, card, d) {
        p.rot = ((p.rot + d) % 360 + 360) % 360;
        this.applyThumbRotation(p, card.querySelector('.pthumb'));
        this.tool.onSelect?.(this);
    }

    applyThumbRotation(p, box) {
        const c = box.querySelector('canvas');
        if (!c) return;
        const bw = box.clientWidth, bh = box.clientHeight;
        const fit = Math.min(bw / c.width, bh / c.height);
        const dw = c.width * fit, dh = c.height * fit;
        const s = p.rot % 180 ? Math.min(bw / dh, bh / dw) : 1;
        c.style.transform = `rotate(${p.rot}deg) scale(${s})`;
    }

    async drawPageThumb(p, box) {
        try {
            p.file.thumbs = p.file.thumbs || {};
            let src = p.file.thumbs[p.index];
            if (!src && p.image) {
                const bmp = await loadImageBitmap(p.file.file);
                const s = 180 / bmp.width;
                src = h('canvas', { width: 180, height: Math.max(1, Math.round(bmp.height * s)) });
                src.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height);
                p.file.thumbs[0] = src;
            }
            if (!src) src = p.file.thumbs[p.index] = (await PDF.render(p.file.doc, p.index + 1, { width: 180 })).canvas;
            const c = h('canvas', { width: src.width, height: src.height });
            c.getContext('2d').drawImage(src, 0, 0);
            box.replaceChildren(c);
            this.applyThumbRotation(p, box);
        } catch (e) {
            box.replaceChildren(h('span.ph', 'sem prévia'));
        }
    }
}

/**
 * Processa cada arquivo da lista com fn(arquivo, sub), onde sub.progress(fração, texto)
 * já desconta a parte do lote. Com vários arquivos, um erro não interrompe os demais:
 * fica registrado em ctx.state.batchErrors e aparece na tela de resultado.
 */
async function runBatch(ctx, fn) {
    const files = ctx.files, n = files.length;
    const outs = [];
    ctx.state.batchErrors = [];
    ctx.state.batch = [];
    for (let i = 0; i < n; i++) {
        const f = files[i];
        const sub = {
            state: ctx.state, opts: ctx.opts,
            progress: (frac, text) => ctx.progress((i + Math.max(0, Math.min(1, frac))) / n,
                n > 1 ? `Arquivo ${i + 1} de ${n}: ${text || ''}` : text),
        };
        try {
            const out = await fn(f, sub);
            (Array.isArray(out) ? out : [out]).forEach(o => outs.push(o));
            ctx.state.batch.push({ file: f, out });
        } catch (e) {
            if (n === 1) throw e;
            console.error(e);
            ctx.state.batchErrors.push(`${f.file.name}: ${e.message}`);
        }
    }
    if (!outs.length) throw new Error(ctx.state.batchErrors[0] || 'Nada foi gerado.');
    return outs;
}

/** Aviso, na tela de resultado, dos arquivos do lote que falharam */
function batchErrorNote(ctx) {
    const errs = ctx.state.batchErrors || [];
    if (!errs.length) return null;
    return h('span.batch-errors', `${errs.length} ${errs.length === 1 ? 'arquivo não pôde ser processado' : 'arquivos não puderam ser processados'}: `,
        errs.join(' · '));
}

/** Pré-visualização: renderiza uma página de um PDF (bytes) dentro de uma caixa */
async function renderPreview(box, bytes, pageNum = 1, label) {
    const doc = await PDF.open(bytes);
    try {
        const width = Math.min(900, Math.max(300, box.clientWidth - 32)) * (window.devicePixelRatio > 1 ? 1.5 : 1);
        const { canvas } = await PDF.render(doc, Math.min(pageNum, doc.numPages), { width });
        canvas.style.width = Math.min(box.clientWidth - 32, canvas.width / (window.devicePixelRatio > 1 ? 1.5 : 1)) + 'px';
        box.replaceChildren(canvas);
        if (label) box.append(h('p.preview-label', label));
    } finally {
        doc.destroy();
    }
}
