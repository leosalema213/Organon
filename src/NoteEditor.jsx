import { forwardRef, useLayoutEffect, useRef, useState } from 'react';
import { Editor, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import { Dropcursor, Gapcursor, TrailingNode, UndoRedo } from '@tiptap/extensions';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { documentText, isNoteImage, noteDocument } from './note-document.js';
import { FormatToolbar, formatState, richExtensions } from './RichText.jsx';
import { optimizeImage } from './images.js';
import { remoteNoteTransaction } from './note-live.js';

const Image = Node.create({
  name: 'image', group: 'block', atom: true, draggable: true,
  addAttributes() { return { src: { default: '' } }; },
  parseHTML() { return [{ tag: 'img[src]', getAttrs: element => isNoteImage(element.getAttribute('src')) ? { src: element.getAttribute('src') } : false }]; },
  renderHTML({ node }) { return ['img', { src: node.attrs.src, alt: 'Imagem da anotação' }]; },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('figure'); dom.className = 'note-document-image'; dom.contentEditable = 'false';
      const image = document.createElement('img'); image.src = node.attrs.src; image.alt = 'Imagem da anotação';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button';
      remove.hidden = !editor.isEditable;
      remove.setAttribute('aria-label', 'Remover imagem'); remove.title = 'Remover imagem';
      const cross = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      cross.setAttribute('viewBox', '0 0 24 24'); cross.setAttribute('width', '14'); cross.setAttribute('height', '14'); cross.setAttribute('aria-hidden', 'true');
      const strokes = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      strokes.setAttribute('d', 'M18 6 6 18M6 6l12 12'); strokes.setAttribute('stroke', 'currentColor'); strokes.setAttribute('stroke-width', '2'); strokes.setAttribute('stroke-linecap', 'round');
      cross.append(strokes); remove.append(cross);
      remove.addEventListener('mousedown', event => event.preventDefault());
      remove.addEventListener('click', () => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (typeof pos === 'number') { editor.commands.deleteRange({ from: pos, to: pos + node.nodeSize }); editor.view.focus(); }
      });
      dom.append(image, remove);
      return { dom, stopEvent: event => remove.contains(event.target) };
    };
  },
});

// One editor per note: its history and selection survive React autosave renders.
export default forwardRef(function NoteEditor({ note, onChange, notify, rich = true, disabled = false, syncExternal = false }, apiRef) {
  const host = useRef();
  const instance = useRef();
  const handlers = useRef();
  const [format, setFormat] = useState({});
  useLayoutEffect(() => {
    const bookmarks = new Set();
    let pending = 0; let detached = false;
    const callbacks = { onChange, notify }; handlers.current = callbacks;
    const editor = new Editor({
      element: host.current,
      editable: !disabled,
      extensions: [Document, Paragraph, Text, HardBreak, UndoRedo, Dropcursor, Gapcursor, TrailingNode, Image, ...(rich ? richExtensions : [])],
      content: noteDocument(note),
      onCreate: ({ editor }) => { editor.view.dom.dataset.empty = String(editor.isEmpty); },
      editorProps: {
        attributes: { class: 'notebook-text', role: 'textbox', 'aria-label': 'Texto da anotação', 'aria-multiline': 'true', 'data-placeholder': 'Escreva aqui…', spellcheck: 'true' },
        handlePaste: (_view, event) => {
          if (!editor.isEditable) return false;
          const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
          if (!files.length) return false;
          event.preventDefault(); api.images(files); return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (!editor.isEditable) return false;
          if (moved || !event.dataTransfer.files.length) return false;
          event.preventDefault();
          const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (point) editor.commands.setTextSelection(point.pos);
          api.images([...event.dataTransfer.files]); return true;
        },
      },
      onTransaction: ({ transaction, editor }) => {
        for (const token of bookmarks) token.selection = token.selection.map(transaction.mapping);
        if (rich && !detached) setFormat(formatState(editor));
      },
      onUpdate: ({ editor }) => {
        editor.view.dom.dataset.empty = String(editor.isEmpty);
        const document = editor.getJSON(); callbacks.onChange({ document, text: documentText(document), images: [] });
      },
    });
    const capture = () => {
      // A paste can arrive before the browser's deferred selectionchange event.
      const selection = window.getSelection();
      if (document.activeElement === editor.view.dom && selection?.anchorNode && editor.view.dom.contains(selection.anchorNode) && editor.view.dom.contains(selection.focusNode)) {
        const anchor = editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset);
        const head = editor.view.posAtDOM(selection.focusNode, selection.focusOffset);
        const next = TextSelection.between(editor.state.doc.resolve(anchor), editor.state.doc.resolve(head));
        if (!editor.state.selection.eq(next)) editor.view.dispatch(editor.state.tr.setSelection(next));
      }
      const token = { selection: editor.state.selection.getBookmark() }; bookmarks.add(token); return token;
    };
    const insert = (sources, token) => {
      if (editor.isDestroyed) return;
      bookmarks.delete(token);
      const selection = token.selection.resolve(editor.state.doc);
      const follow = editor.state.selection.eq(selection);
      editor.commands.insertContentAt({ from: selection.from, to: selection.to }, sources.map(src => ({ type: 'image', attrs: { src } })), { updateSelection: follow });
      // TrailingNode guarantees a paragraph after the last image; ArrowDown/typing can continue there.
      if (follow) {
        const tr = editor.state.tr;
        editor.view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(tr.selection.to), 1)));
        if (!detached) editor.view.focus();
      }
    };
    const api = {
      goToHeading(index) {
        let current = 0; let target;
        editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading' && current++ === index) target = pos; });
        if (target !== undefined) {
          editor.commands.setTextSelection(target + 1); editor.view.focus();
          editor.view.dom.querySelectorAll('h1,h2,h3')[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      },
      capture,
      cancel: token => bookmarks.delete(token),
      async insert(src, token) {
        pending++;
        try { insert([await optimizeImage(src)], token); }
        catch (error) { bookmarks.delete(token); notify(error.message); }
        finally { pending--; if (detached && !pending) editor.destroy(); }
      },
      async images(files, token = capture()) {
        pending++;
        try {
          const sources = [];
          for (const file of files) {
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { notify('Use imagens PNG, JPG ou WebP.'); continue; }
            let src;
            try { src = await optimizeImage(file); } catch (error) { notify(error.message); continue; }
            if (isNoteImage(src)) sources.push(src); else notify('Não foi possível ler esta imagem.');
          }
          if (sources.length) insert(sources, token); else bookmarks.delete(token);
        } finally { pending--; if (detached && !pending) editor.destroy(); }
      },
    };
    instance.current = editor; apiRef.current = api;
    if (rich) setFormat({});
    return () => {
      if (apiRef.current === api) apiRef.current = null;
      instance.current = null;
      if (handlers.current === callbacks) handlers.current = null;
      detached = true;
      // Finish an in-flight paste against the original note even after switching notes.
      if (!pending) editor.destroy();
    };
  }, [note.id, rich]);
  useLayoutEffect(() => { if (handlers.current) { handlers.current.onChange = onChange; handlers.current.notify = notify; } });
  useLayoutEffect(() => {
    const editor = instance.current;
    if (!syncExternal || !editor || editor.isDestroyed) return;
    const next = editor.schema.nodeFromJSON(noteDocument(note));
    const transaction = remoteNoteTransaction(editor.state, next);
    if (!transaction) return;
    // Map selections, image bookmarks and local history through the smallest remote patch.
    editor.view.dispatch(transaction);
    editor.view.dom.dataset.empty = String(editor.isEmpty);
  }, [note, syncExternal]);
  useLayoutEffect(() => { instance.current?.setEditable(!disabled, false); host.current?.querySelectorAll('.note-document-image button').forEach(button => { button.hidden = disabled; }); }, [disabled]);
  return <>{rich && !disabled && <FormatToolbar editor={instance.current} state={format} />}<div className="note-document-editor" ref={host} /></>;
});
