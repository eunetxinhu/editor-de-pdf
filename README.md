# Editor de PDF

Ferramentas de PDF no estilo do iLovePDF, só que **100% no navegador**: nenhum arquivo é enviado para servidor. Basta abrir o `index.html` (ou publicar no GitHub Pages).

## Ferramentas

| Categoria | Ferramentas |
|---|---|
| Organizar | Juntar PDF · Dividir PDF · Remover páginas · Extrair páginas · Organizar PDF (arrastar, girar, duplicar, excluir, página em branco, juntar páginas de vários PDFs) · Girar PDF |
| Otimizar | Comprimir PDF (leve / recomendada / forte mantendo o texto, ou máxima rasterizando) · Reparar PDF |
| Converter para PDF | Imagem para PDF (A4, Carta ou tamanho da imagem; orientação e margem) · Word para PDF |
| Converter de PDF | PDF para imagem (JPG/PNG, 96/150/300 dpi) · PDF para Word (.docx editável) |
| Editar | Marca d'água (texto ou imagem, mosaico, inclinação, transparência) · Números de página · Assinar PDF (desenhar, digitar ou enviar imagem) · Editar PDF (texto, imagem, cobrir, destacar) · Recortar PDF |
| Segurança | Proteger PDF (AES-256, com restrições de impressão/cópia/edição) · Desbloquear PDF |
| Outras | Gerar contrato (junta PDFs e fotos com o nome do beneficiário) · Converter imagem (JPG/PNG/WEBP, redimensionar) |

Depois de processar, a tela de resultado permite **continuar com o mesmo arquivo** em outra ferramenta (ex.: juntar → comprimir → proteger).

## Como funciona

- **[pdf-lib](https://pdf-lib.js.org/)**: criar e modificar PDFs.
- **[PDF.js](https://mozilla.github.io/pdf.js/)**: miniaturas, pré-visualização, leitura de texto e rasterização.
- **[qpdf](https://github.com/neslinesli93/qpdf-wasm)** (WebAssembly): senha, desbloqueio, reparo e otimização sem perdas.
- **[JSZip](https://stuk.github.io/jszip/)**, **[docx](https://docx.js.org/)**, **[mammoth](https://github.com/mwilliamson/mammoth.js)**, **[jsPDF](https://github.com/parallax/jsPDF)** + **html2canvas**: zip, Word e conversão de .docx.

As bibliotecas vêm de CDN (jsDelivr). Só pdf-lib e PDF.js carregam no início; as outras são baixadas quando a ferramenta é usada.

## Estrutura

```
index.html
assets/css/app.css         estilos (tema claro/escuro)
assets/js/core.js          utilitários, bibliotecas sob demanda, funções de PDF
assets/js/ui.js            rotas, tela inicial, página de ferramenta, grade de páginas
assets/js/editor.js        editor visual (assinar, editar, recortar) e janela de assinatura
assets/js/tools/*.js       uma ferramenta = um App.register({...})
```

Para criar uma ferramenta nova, registre um objeto com `id`, `cat`, `title`, `accept`, `options(ctx)` e `run(ctx)` (que devolve `{ blob, name }` ou uma lista deles, que vira .zip automaticamente).

## Limitações conhecidas

- PDF para Word extrai o texto em parágrafos; colunas e tabelas complexas podem precisar de ajuste. PDFs digitalizados entram como imagem (não há OCR).
- Word para PDF simplifica fontes especiais e layouts elaborados.
- "Cobrir" no Editar esconde visualmente, mas o texto original continua no arquivo. Para sigilo real, comprima depois no modo Máxima.
