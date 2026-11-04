import React, { useEffect, useRef, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { requestThumbnail } from './book-thumbnails.js';

export default function BookThumbnail({ book, downloadSharedBook }) {
  const target = useRef(), [src, setSrc] = useState(null);
  useEffect(() => {
    if (book.format !== 'pdf' || !window.desktop?.books?.thumbnail) return;
    let disposed = false, request;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || request) return;
      request = requestThumbnail(book.hash, book.orgId && downloadSharedBook ? async () => {
        const result = await downloadSharedBook(book.orgId, book.id);
        if (result.book?.hash !== book.hash) throw new Error('O livro compartilhado mudou.');
      } : undefined); observer.disconnect();
      request.result.then(value => { if (!disposed) setSrc(value); }).catch(() => {});
    }, { rootMargin: '100px' });
    observer.observe(target.current);
    return () => { disposed = true; observer.disconnect(); request?.release(); };
  }, [book.hash, book.format, book.orgId, book.id, downloadSharedBook]);
  return <span className="book-thumbnail" ref={target} aria-hidden="true">{src ? <img src={src} alt="" draggable={false} onError={() => setSrc(null)} /> : <><BookOpen size={34} /><span>{book.format.toUpperCase()}</span></>}</span>;
}
