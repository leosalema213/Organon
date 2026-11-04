import { useEffect, useRef, useState } from 'react';
import { listInsertion, reorderedLists } from './list-drag.js';

export default function useListDrag(boardRef, contextKey, onMove) {
  const active = useRef(null), pointer = useRef(null), move = useRef(onMove);
  const [preview, setPreview] = useState(null);
  move.current = onMove;
  useEffect(() => {
    let frame = 0, previousTime = 0;
    function stopScroll() { cancelAnimationFrame(frame); frame = 0; previousTime = 0; }
    function cancel() {
      stopScroll();
      for (const column of active.current?.columns || []) column.element.style.removeProperty('transform');
      active.current = null; pointer.current = null; setPreview(null);
    }
    function update() {
      const board = boardRef.current, drag = active.current;
      if (!board || !drag || !pointer.current) return;
      // Original slots stay fixed while columns animate. Reading animated rectangles
      // again here would make the target oscillate under a stationary pointer.
      const beforeId = listInsertion(drag.columns, drag.record.id, pointer.current.x + board.scrollLeft - drag.scrollLeft);
      if (drag.beforeId === beforeId) return;
      drag.beforeId = beforeId;
      const next = reorderedLists(drag.columns, drag.record.id, beforeId);
      next.forEach((column, index) => {
        column.element.style.transform = `translateX(${drag.columns[index].left - column.left}px)`;
      });
    }
    function scrollStrength() {
      const board = boardRef.current, drag = active.current, point = pointer.current;
      if (!board || !drag || !point) return 0;
      const bounds = drag.bounds, edge = Math.min(64, bounds.width / 4);
      if (point.y < bounds.top || point.y > bounds.bottom || point.x < bounds.left || point.x > bounds.right) return 0;
      if (point.x < bounds.left + edge && board.scrollLeft > 0) return -(1 - (point.x - bounds.left) / edge);
      if (point.x > bounds.right - edge && board.scrollLeft < drag.maxScroll) return 1 - (bounds.right - point.x) / edge;
      return 0;
    }
    function scroll(time) {
      const strength = scrollStrength();
      if (!strength) { stopScroll(); return; }
      boardRef.current.scrollLeft += strength * Math.min(time - previousTime || 16, 32) * .7;
      update();
      previousTime = time; frame = requestAnimationFrame(scroll);
    }
    function over(event) {
      if (!active.current) return;
      pointer.current = { x: event.clientX, y: event.clientY };
      if (scrollStrength()) { if (!frame) frame = requestAnimationFrame(scroll); }
      else stopScroll();
      if (boardRef.current?.contains(event.target)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; update(); }
    }
    function drop(event) {
      const drag = active.current, board = boardRef.current;
      if (drag && board?.contains(event.target)) {
        event.preventDefault();
        pointer.current = { x: event.clientX, y: event.clientY }; update();
        move.current(drag.record, drag.beforeId);
      }
      cancel();
    }
    function key(event) { if (event.key === 'Escape') cancel(); }
    cancel();
    document.addEventListener('dragover', over);
    document.addEventListener('drop', drop);
    document.addEventListener('dragend', cancel);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', cancel);
    return () => {
      stopScroll();
      for (const column of active.current?.columns || []) column.element.style.removeProperty('transform');
      active.current = null; pointer.current = null;
      document.removeEventListener('dragover', over); document.removeEventListener('drop', drop);
      document.removeEventListener('dragend', cancel); document.removeEventListener('keydown', key);
      window.removeEventListener('resize', cancel);
    };
  }, [boardRef, contextKey]);
  function start(event, record) {
    if (event.target.closest('button, input, select, textarea, a')) { event.preventDefault(); return; }
    const board = boardRef.current, column = event.currentTarget.closest('[data-list-id]'), bounds = column.getBoundingClientRect();
    event.dataTransfer.setData('text/plain', record.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(column, event.clientX - bounds.left, event.clientY - bounds.top);
    const columns = [...board.querySelectorAll('[data-list-id]')].map(element => {
      const { left, width } = element.getBoundingClientRect();
      return { id: element.dataset.listId, element, left, width };
    });
    active.current = { record, columns, bounds: board.getBoundingClientRect(), scrollLeft: board.scrollLeft, maxScroll: board.scrollWidth - board.clientWidth, beforeId: columns[columns.findIndex(item => item.id === record.id) + 1]?.id ?? null };
    pointer.current = { x: event.clientX, y: event.clientY };
    // Let Chromium capture the complete native drag image before hiding its
    // original content to display the empty slot.
    requestAnimationFrame(() => { if (active.current?.record === record) setPreview({ id: record.id }); });
  }
  return { preview, start };
}
