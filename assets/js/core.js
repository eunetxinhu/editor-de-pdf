/* ============================================================
   Núcleo: utilitários, carregamento de bibliotecas e funções
   de PDF compartilhadas por todas as ferramentas.
   ============================================================ */
'use strict';

const App = {
    tools: [],
    categories: [
        { id: 'organizar', name: 'Organizar PDF' },
        { id: 'otimizar', name: 'Otimizar PDF' },
        { id: 'para-pdf', name: 'Converter para PDF' },
        { id: 'de-pdf', name: 'Converter de PDF' },
        { id: 'editar', name: 'Editar PDF' },
        { id: 'seguranca', name: 'Segurança do PDF' },
        { id: 'extras', name: 'Outras ferramentas' },
    ],
    register(tool) { this.tools.push(tool); },
    tool(id) { return this.tools.find(t => t.id === id); },
};

/* ---------- bibliotecas (carregadas sob demanda) ---------- */
const CDN = 'https://cdn.jsdelivr.net/npm/';
const LIBS = {
    pdfjsWorker: CDN + 'pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    jszip: CDN + 'jszip@3.10.1/dist/jszip.min.js',
    docx: CDN + 'docx@9.15.2/dist/index.iife.js',
    mammoth: CDN + 'mammoth@1.13.0/mammoth.browser.min.js',
    jspdf: CDN + 'jspdf@2.5.2/dist/jspdf.umd.min.js',
    html2canvas: CDN + 'html2canvas@1.4.1/dist/html2canvas.min.js',
    qpdf: CDN + '@neslinesli93/qpdf-wasm@0.3.1/dist/qpdf.js',
    qpdfWasm: CDN + '@neslinesli93/qpdf-wasm@0.3.1/dist/qpdf.wasm',
};

const _scripts = {};
function loadScript(url) {
    if (!_scripts[url]) {
        _scripts[url] = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = resolve;
            s.onerror = () => {
                delete _scripts[url];
                reject(new Error('Não foi possível baixar um componente necessário. Verifique sua conexão com a internet.'));
            };
            document.head.appendChild(s);
        });
    }
    return _scripts[url];
}

const Libs = {
    async zip() { await loadScript(LIBS.jszip); return window.JSZip; },
    async docx() { await loadScript(LIBS.docx); return window.docx; },
    async mammoth() { await loadScript(LIBS.mammoth); return window.mammoth; },
    async jspdf() {
        await Promise.all([loadScript(LIBS.jspdf), loadScript(LIBS.html2canvas)]);
        return window.jspdf.jsPDF;
    },
    /** Executa o qpdf (WebAssembly) com os argumentos dados.
     *  Devolve { code, output } onde output é o arquivo gerado (Uint8Array). */
    async qpdf(inputBytes, args) {
        await loadScript(LIBS.qpdf);
        const errors = [];
        // O qpdf escreve os erros direto no console (guarda a referência ao criar o módulo).
        // Capturamos durante a execução para mostrar mensagens úteis ao usuário.
        const origError = console.error;
        console.error = (...a) => errors.push(a.join(' '));
        try {
            const mod = await window.Module({ locateFile: () => LIBS.qpdfWasm, print: () => {} });
            mod.FS.writeFile('/in.pdf', new Uint8Array(inputBytes));
            let code;
            try {
                code = mod.callMain(args.map(a => a === '{in}' ? '/in.pdf' : a === '{out}' ? '/out.pdf' : a));
            } catch (e) {
                code = typeof e.status === 'number' ? e.status : 2;
            }
            let output = null;
            try { output = mod.FS.readFile('/out.pdf'); } catch (e) { /* sem saída */ }
            return { code, output, errors: errors.join('\n') };
        } finally {
            console.error = origError;
        }
    },
};

/* ---------- DOM ---------- */
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

/** Cria elementos: h('div.classe#id', {atributos}, filhos...) */
function h(tag, attrs, ...children) {
    const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
    const el = document.createElement(name || 'div');
    rest.replace(/([.#])([\w-]+)/g, (_, t, v) => {
        if (t === '.') el.classList.add(v); else el.id = v;
    });
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
        children.unshift(attrs);
        attrs = null;
    }
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === false || v == null) continue;
        if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className += ' ' + v;
        else if (k === 'style' && typeof v === 'object') {
            for (const [sk, sv] of Object.entries(v)) {
                if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
            }
        }
        else if (k === 'html') el.innerHTML = v;
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
        if (c == null || c === false) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

/** Ícones (traço) usados na interface */
const ICONS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    rotR: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    rotL: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    down: '<path d="M12 4v12M6 10l6 6 6-6M5 20h14"/>',
    upload: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    move: '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    resize: '<path d="M8 20h12V8"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
};
function icon(name, cls = '') {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    s.innerHTML = ICONS[name] || name;
    return s;
}

function toast(message, type = 'ok') {
    const el = h('div.toast' + (type === 'error' ? '.error' : ''), { role: type === 'error' ? 'alert' : 'status' }, message);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- arquivos ---------- */
function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1).replace('.', ',') + ' MB';
}
function baseName(name) { return name.replace(/\.[^.]+$/, ''); }
/** Remove caracteres proibidos em nomes de arquivo no Windows/macOS */
function safeFileName(name) {
    return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'arquivo';
}
function isPdf(f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); }
function isImage(f) { return f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name); }
function isDocx(f) { return /\.docx$/i.test(f.name) || f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function pdfBlob(bytes) { return new Blob([bytes], { type: 'application/pdf' }); }

function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.')), type, quality);
    });
}

/** Lê uma imagem (respeitando a orientação EXIF de fotos de celular) */
async function loadImageBitmap(file) {
    try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
        const url = URL.createObjectURL(file);
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            return img;
        } finally {
            URL.revokeObjectURL(url);
        }
    }
}

/** Junta vários arquivos de saída em um .zip */
async function zipOutputs(outputs, zipName) {
    const JSZip = await Libs.zip();
    const zip = new JSZip();
    const used = new Set();
    for (const o of outputs) {
        let name = o.name, i = 2;
        while (used.has(name)) name = baseName(o.name) + ` (${i++})` + o.name.slice(baseName(o.name).length);
        used.add(name);
        zip.file(name, o.blob);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    return { blob, name: zipName };
}

/* ---------- PDF ---------- */
const PDF = {
    A4: [595.28, 841.89],
    LETTER: [612, 792],

    /** Abre com pdf-lib, com mensagem amigável para PDFs protegidos */
    async load(bytes, opts = {}) {
        try {
            return await PDFLib.PDFDocument.load(bytes, { updateMetadata: false, ...opts });
        } catch (e) {
            if (/encrypt/i.test(e.message)) {
                throw new Error('Este PDF está protegido por senha. Use a ferramenta "Desbloquear PDF" primeiro.');
            }
            throw new Error('Não foi possível ler o PDF. Ele pode estar corrompido; tente "Reparar PDF".');
        }
    },

    /** Abre com pdf.js (para renderizar e ler texto) */
    async open(bytes, password) {
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
        // pdf.js "consome" o buffer; passamos uma cópia
        const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes).slice(), password, isEvalSupported: false });
        try {
            return await task.promise;
        } catch (e) {
            if (e && e.name === 'PasswordException') {
                throw new Error('Este PDF está protegido por senha. Use a ferramenta "Desbloquear PDF" primeiro.');
            }
            throw new Error('Não foi possível ler o PDF. Ele pode estar corrompido; tente "Reparar PDF".');
        }
    },

    /** Renderiza uma página (1-based) num canvas. width = largura desejada em px, ou scale. */
    async render(doc, pageNum, { width, scale, rotation = 0, canvas } = {}) {
        const page = await doc.getPage(pageNum);
        const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
        const s = scale || (width / base.width);
        const vp = page.getViewport({ scale: s, rotation: (page.rotate + rotation) % 360 });
        canvas = canvas || document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        return { canvas, viewport: vp, base, page };
    },

    /** "1, 3, 5-7, 10-" → índices 0-based (na ordem escrita, sem repetir) */
    parseRanges(text, total) {
        const out = [];
        const seen = new Set();
        for (const group of this.parseGroups(text, total)) {
            for (const i of group) if (!seen.has(i)) { seen.add(i); out.push(i); }
        }
        return out;
    },

    /** Cada parte separada por vírgula vira um grupo de índices 0-based */
    parseGroups(text, total) {
        const groups = [];
        for (let part of String(text || '').split(/[,;]+/)) {
            part = part.trim().toLowerCase();
            if (!part) continue;
            if (part === 'fim' || part === 'última' || part === 'ultima') part = String(total);
            const m = part.match(/^(\d*)\s*[-–a]\s*(\d*|fim)$/);
            let a, b;
            if (m) {
                a = m[1] ? +m[1] : 1;
                b = m[2] && m[2] !== 'fim' ? +m[2] : total;
            } else if (/^\d+$/.test(part)) {
                a = b = +part;
            } else continue;
            if (a > b) [a, b] = [b, a];
            a = Math.max(1, a); b = Math.min(total, b);
            const g = [];
            for (let i = a; i <= b; i++) g.push(i - 1);
            if (g.length) groups.push(g);
        }
        return groups;
    },

    /** Índices 0-based → texto compacto "1-3, 5" */
    formatRanges(indices) {
        const s = [...new Set(indices)].sort((a, b) => a - b).map(i => i + 1);
        const parts = [];
        for (let i = 0; i < s.length; i++) {
            let j = i;
            while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
            parts.push(j > i ? `${s[i]}-${s[j]}` : String(s[i]));
            i = j;
        }
        return parts.join(', ');
    },

    /** Copia páginas de um documento para um novo */
    async pick(srcDoc, indices) {
        const out = await PDFLib.PDFDocument.create();
        const pages = await out.copyPages(srcDoc, indices);
        pages.forEach(p => out.addPage(p));
        return out;
    },

    /**
     * Converte coordenadas "visuais" (origem no canto superior esquerdo da página
     * como ela aparece na tela, já considerando a rotação) para coordenadas do PDF.
     */
    geom(page) {
        const box = page.getCropBox();
        const rot = ((page.getRotation().angle % 360) + 360) % 360;
        const W = box.width, H = box.height, x0 = box.x, y0 = box.y;
        const vw = rot % 180 ? H : W;
        const vh = rot % 180 ? W : H;
        const toPdf = (vx, vy) => {
            switch (rot) {
                case 90: return { x: x0 + vy, y: y0 + vx };
                case 180: return { x: x0 + W - vx, y: y0 + vy };
                case 270: return { x: x0 + W - vy, y: y0 + H - vx };
                default: return { x: x0 + vx, y: y0 + H - vy };
            }
        };
        return { rot, vw, vh, toPdf };
    },

    /** Remove caracteres que a fonte padrão não consegue escrever */
    safeText(font, text) {
        let out = '';
        for (const ch of String(text)) {
            try { font.encodeText(ch); out += ch; }
            catch (e) {
                const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
                try { font.encodeText(plain); out += plain; } catch (e2) { out += '?'; }
            }
        }
        return out;
    },

    /**
     * Desenha um texto centralizado no ponto visual (cx, cy), girado `angle` graus
     * (sentido anti-horário, como visto na tela).
     */
    drawTextCentered(page, text, { font, size, color, opacity = 1, angle = 0, cx, cy }) {
        const g = this.geom(page);
        const w = font.widthOfTextAtSize(text, size);
        const hgt = font.heightAtSize(size, { descender: false });
        const a = (angle * Math.PI) / 180;
        // vetor do centro até a origem do texto (canto inferior esquerdo), em coordenadas visuais (y para baixo)
        const vx = -w / 2, vy = hgt / 2 * 0.85;
        const ox = cx + vx * Math.cos(a) + vy * Math.sin(a);
        const oy = cy - vx * Math.sin(a) + vy * Math.cos(a);
        const p = g.toPdf(ox, oy);
        page.drawText(text, {
            x: p.x, y: p.y, size, font, color, opacity,
            rotate: PDFLib.degrees(angle + g.rot),
        });
    },

    hexToRgb(hex) {
        const n = parseInt(hex.replace('#', ''), 16);
        return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    },

    async save(doc) { return await doc.save({ useObjectStreams: true }); },
};
