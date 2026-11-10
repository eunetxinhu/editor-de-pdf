/* Ferramentas de segurança: proteger com senha e desbloquear */
'use strict';

function randomPassword() {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

function passwordInput(value, onInput, placeholder) {
    const input = h('input.input', { type: 'password', value, placeholder, autocomplete: 'new-password', oninput: e => onInput(e.target.value) });
    const toggle = h('button.btn.btn-sm.btn-ghost', {
        type: 'button', 'aria-label': 'Mostrar senha',
        onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; toggle.textContent = input.type === 'password' ? 'Mostrar' : 'Ocultar'; },
    }, 'Mostrar');
    return h('div', { style: { display: 'flex', gap: '6px' } }, input, toggle);
}

App.register({
    id: 'protect',
    cat: 'seguranca',
    title: 'Proteger PDF',
    desc: 'Coloque uma senha em um ou vários PDFs para impedir que outras pessoas abram.',
    keywords: 'senha criptografar bloquear',
    icon: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    accept: 'pdf',
    multiple: true,
    sortable: false,
    actionLabel: 'Proteger PDF',
    doneTitle: 'Proteção aplicada',
    zipName: () => 'pdfs-protegidos.zip',
    next: ['merge', 'compress'],
    defaults: { pass: '', pass2: '', print: true, copy: true, edit: true },
    validate(ctx) {
        if (!ctx.opts.pass) return 'Digite uma senha.';
        if (ctx.opts.pass !== ctx.opts.pass2) return 'As senhas não são iguais.';
        return null;
    },
    options(ctx) {
        const upd = () => ctx.updateAction();
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.field('Senha', passwordInput(ctx.opts.pass, v => { ctx.opts.pass = v; upd(); }, 'Digite a senha')),
            F.field('Repita a senha', passwordInput(ctx.opts.pass2, v => { ctx.opts.pass2 = v; upd(); }, 'Digite de novo')),
            h('div.field', h('span.label', 'Quem abrir o arquivo poderá'),
                F.check('Imprimir', ctx.opts.print, v => ctx.opts.print = v),
                F.check('Copiar texto e imagens', ctx.opts.copy, v => ctx.opts.copy = v),
                F.check('Editar o documento', ctx.opts.edit, v => ctx.opts.edit = v)),
            F.note('Criptografia AES de 256 bits. ', h('b', 'Guarde a senha: '), 'não há como recuperá-la depois.'));
    },
    run: ctx => runBatch(ctx, async (f, sub) => {
        const o = ctx.opts;
        sub.progress(0.3, 'Criptografando...');
        const restrictions = [];
        if (!o.print) restrictions.push('--print=none');
        if (!o.copy) restrictions.push('--extract=n');
        if (!o.edit) restrictions.push('--modify=none', '--annotate=n', '--assemble=n', '--form=n');
        const r = await Libs.qpdf(f.bytes, ['--encrypt', o.pass, randomPassword(), '256', ...restrictions, '--', '{in}', '{out}']);
        if (!r.output?.length || (r.code !== 0 && r.code !== 3)) {
            if (/password/i.test(r.errors)) throw new Error('Este PDF já tem senha. Use "Desbloquear PDF" primeiro.');
            throw new Error('Não foi possível proteger o arquivo.');
        }
        return { blob: pdfBlob(r.output), name: baseName(f.file.name) + '-protegido.pdf' };
    }),
});

App.register({
    id: 'unlock',
    cat: 'seguranca',
    title: 'Desbloquear PDF',
    desc: 'Remova a senha e as restrições de um PDF que você tem permissão para abrir.',
    keywords: 'remover senha desproteger',
    icon: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>',
    accept: 'pdf',
    multiple: true,
    sortable: false,
    keepUnreadable: true,
    actionLabel: 'Desbloquear PDF',
    doneTitle: 'Desbloqueio concluído',
    zipName: () => 'pdfs-desbloqueados.zip',
    defaults: { pass: '' },
    options(ctx) {
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.field('Senha do PDF', passwordInput(ctx.opts.pass, v => ctx.opts.pass = v, 'Senha para abrir'),
                'Se o arquivo abre sem senha mas bloqueia impressão ou cópia, deixe em branco. Com vários arquivos, a mesma senha é usada em todos.'),
            F.note('Use apenas em documentos seus ou que você tem autorização para desbloquear.'));
    },
    run: ctx => runBatch(ctx, async (f, sub) => {
        sub.progress(0.2, 'Verificando...');
        let plain = false;
        try { plain = !(await PDFLib.PDFDocument.load(f.bytes, { updateMetadata: false })).isEncrypted; } catch (e) { /* protegido ou com erro */ }
        if (plain) throw new Error('Este PDF não tem senha nem restrições.');
        sub.progress(0.5, 'Removendo a proteção...');
        const r = await Libs.qpdf(f.bytes, ['--decrypt', '--password=' + ctx.opts.pass, '{in}', '{out}']);
        if (!r.output?.length || (r.code !== 0 && r.code !== 3)) {
            if (/invalid password/i.test(r.errors)) {
                throw new Error(ctx.opts.pass ? 'Senha incorreta. Confira e tente de novo.' : 'Este PDF precisa de senha para abrir. Digite a senha.');
            }
            throw new Error('Não foi possível desbloquear o arquivo.');
        }
        return { blob: pdfBlob(r.output), name: baseName(f.file.name) + '-desbloqueado.pdf' };
    }),
});
