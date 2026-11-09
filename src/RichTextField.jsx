import { forwardRef, useLayoutEffect, useRef, useState } from 'react';
import { Editor, Extension, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import { UndoRedo } from '@tiptap/extensions';
import { Plugin } from '@tiptap/pm/state';
import { FormatToolbar, formatState, richExtensions } from './RichText.jsx';
import { documentText } from './note-document.js';

// The toolbar/schema are shared with notebooks; the field owns its selection and undo history.
export default forwardRef(function RichTextField({ content, label, identity, onChange, onFiles, loadImage, maxLength, disabled = false, toolbarEnd, autoFocus = false }, ref) {
  const host = useRef(), editorRef = useRef(), callbacks = useRef();
  callbacks.current = { onChange, onFiles, loadImage, disabled };
  const [state, setState] = useState({});
  useLayoutEffect(() => {
    const bookmarks = new Set();
    const Image = Node.create({
      name: 'fieldImage', inline: true, group: 'inline', atom: true, draggable: true,
      addAttributes: () => ({ src: { default: '', parseHTML: element => element.getAttribute('src') } }),
      parseHTML: () => [{ tag: 'img[src]' }], renderHTML: ({ node }) => ['img', { src: node.attrs.src }],
      addNodeView() { return ({ node }) => {
        const dom = document.createElement('span'); dom.className = 'rich-field-image'; dom.contentEditable = 'false'; dom.textContent = 'Imagem';
        let disposed = false, url;
        Promise.resolve(callbacks.current.loadImage?.(node.attrs.src)).then(result => {
          if (disposed || !result) return;
          url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
          const image = document.createElement('img'); image.src = url; image.alt = 'Imagem da carta'; dom.replaceChildren(image);
        }).catch(() => { if (!disposed) dom.textContent = 'Imagem indisponível'; });
        return { dom, destroy() { disposed = true; if (url) URL.revokeObjectURL(url); } };
      }; },
    });
    const Limit = Extension.create({ name: 'fieldLimit', addProseMirrorPlugins: () => [new Plugin({ filterTransaction: tr => !tr.docChanged || !maxLength || documentText(tr.doc.toJSON()).length <= maxLength })] });
    const editor = new Editor({
      element: host.current, extensions: [Document, Paragraph.extend({ parseHTML: () => [{ tag: 'p' }, { tag: 'div' }] }), Text, HardBreak, UndoRedo, ...richExtensions, ...(loadImage ? [Image] : []), Limit], content,
      editable: !disabled, autofocus: autoFocus ? 'start' : false,
      editorProps: {
        attributes: { class: 'notebook-text rich-text-content', role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'true' },
        handlePaste: (_view, event) => {
          const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
          if (!files.length || !callbacks.current.onFiles) return false;
          event.preventDefault(); callbacks.current.onFiles(files); return true;
        },
        handleDrop: (view, event) => {
          if (!event.dataTransfer.files.length || !callbacks.current.onFiles) return false;
          event.preventDefault(); const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (point) editor.commands.setTextSelection(point.pos);
          callbacks.current.onFiles([...event.dataTransfer.files]); return true;
        },
      },
      onTransaction: ({ editor, transaction }) => { for (const token of bookmarks) token.selection = token.selection.map(transaction.mapping); setState(formatState(editor)); },
      onUpdate: ({ editor }) => callbacks.current.onChange({ html: editor.getHTML(), document: editor.getJSON(), text: documentText(editor.getJSON()) }),
    });
    editorRef.current = editor; setState(formatState(editor));
    const api = {
      capture() { const token = { selection: editor.state.selection.getBookmark() }; bookmarks.add(token); return token; },
      cancel(token) { bookmarks.delete(token); },
      insert(html, token) { if (editor.isDestroyed) return; const selection = token?.selection.resolve(editor.state.doc) || editor.state.selection; bookmarks.delete(token); editor.commands.insertContentAt({ from: selection.from, to: selection.to }, html); editor.view.focus(); },
    };
    if (ref) ref.current = api;
    return () => { if (ref?.current === api) ref.current = null; editorRef.current = null; editor.destroy(); };
  }, [identity]);
  useLayoutEffect(() => { editorRef.current?.setEditable(!disabled, false); }, [disabled]);
  return <div className={`rich-text-field ${disabled ? 'is-disabled' : ''}`}><FormatToolbar editor={disabled ? null : editorRef.current} state={state}>{toolbarEnd}</FormatToolbar><div ref={host} /></div>;
});
