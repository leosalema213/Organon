import { useLayoutEffect, useRef } from 'react';

function measureColumn(column) {
  const grid = column.querySelector('.kanban-cards');
  const bounds = grid.getBoundingClientRect();
  const style = getComputedStyle(grid);
  return {
    id: column.dataset.listId,
    grid,
    bounds,
    horizontal: column.getBoundingClientRect(),
    gap: parseFloat(style.rowGap) || 0,
    minHeight: parseFloat(style.minHeight) || 0,
    cards: [...grid.querySelectorAll('[data-card-id]')].map(element => ({
      id: element.dataset.cardId, element, bounds: element.getBoundingClientRect(),
    })),
  };
}

export default function useCardDrag(boardRef, boardId, cards, lists, disabled, onMove) {
  const cancel = useRef(null), move = useRef(onMove);
  move.current = onMove;
  useLayoutEffect(() => () => cancel.current?.(), [boardId, cards, lists, disabled]);

  return function start(event, card) {
    if (disabled) { event.preventDefault(); return; }
    cancel.current?.();
    const board = boardRef.current, element = event.currentTarget;
    const columns = [...board.querySelectorAll('[data-list-id]')].map(measureColumn);
    const source = columns.find(column => column.id === card.list_id);
    const dragged = source?.cards.find(item => item.id === card.id);
    if (!dragged) { event.preventDefault(); return; }

    const bounds = board.getBoundingClientRect();
    const initialX = board.scrollLeft, initialY = board.scrollTop;
    const height = dragged.bounds.height;
    const listeners = new AbortController(), options = { signal: listeners.signal };
    const placeholder = document.createElement('div');
    placeholder.className = 'kanban-card-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.height = `${height}px`;
    let target = null, beforeId, point, frame = 0, previousTime = 0;

    function restore(column) {
      column.grid.style.removeProperty('margin-bottom');
      for (const item of column.cards) item.element.style.removeProperty('transform');
    }

    function layout(column, insert) {
      // Use the original geometry so animated cards never change the hit targets.
      let top = column.bounds.top, count = 0;
      const place = () => {
        placeholder.style.top = `${top - column.bounds.top}px`;
        column.grid.appendChild(placeholder);
        top += height + column.gap;
        count++;
      };
      for (const item of column.cards) {
        if (item === dragged) continue;
        if (insert && item.id === beforeId) place();
        item.element.style.transform = `translateY(${top - item.bounds.top}px)`;
        top += item.bounds.height + column.gap;
        count++;
      }
      if (insert && beforeId === null) place();
      const previewHeight = Math.max(column.minHeight, count ? top - column.bounds.top - column.gap : 0);
      column.grid.style.marginBottom = `${previewHeight - column.bounds.height}px`;
    }

    function update() {
      const { x, y } = point;
      const inside = x >= bounds.left && x < bounds.left + board.clientWidth && y >= bounds.top && y < bounds.top + board.clientHeight;
      const boardX = x + board.scrollLeft - initialX, boardY = y + board.scrollTop - initialY;
      const next = inside ? columns.find(column => boardX >= column.horizontal.left && boardX < column.horizontal.right) : null;
      const nextBefore = next?.cards.find(item => item !== dragged && boardY < item.bounds.top + item.bounds.height / 2)?.id ?? null;
      if (next === target && nextBefore === beforeId) return;
      if (target && target !== source && target !== next) restore(target);
      placeholder.remove();
      target = next;
      beforeId = nextBefore;
      if (!target) { restore(source); return; }
      layout(source, target === source);
      if (target !== source) layout(target, true);
    }

    function speed(position, start, length, offset, total) {
      const edge = Math.min(48, length / 4), distance = position - start;
      if (distance < 0 || distance >= length) return 0;
      if (distance < edge && offset > 0) return distance / edge - 1;
      if (distance > length - edge && offset < total - length) return 1 - (length - distance) / edge;
      return 0;
    }

    function velocity() {
      if (point.x < bounds.left || point.x >= bounds.left + board.clientWidth || point.y < bounds.top || point.y >= bounds.top + board.clientHeight) return [0, 0];
      return [
        speed(point.x, bounds.left, board.clientWidth, board.scrollLeft, board.scrollWidth),
        speed(point.y, bounds.top, board.clientHeight, board.scrollTop, board.scrollHeight),
      ];
    }

    function scroll(time) {
      const [x, y] = velocity();
      if (!x && !y) { frame = 0; previousTime = 0; return; }
      const step = Math.min(time - previousTime || 16, 32) * .65;
      board.scrollBy(x * step, y * step);
      update();
      previousTime = time;
      frame = requestAnimationFrame(scroll);
    }

    function track(event) {
      point = { x: event.clientX, y: event.clientY };
      update();
    }

    function cleanup() {
      listeners.abort();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(activate);
      board.classList.remove('is-sorting-cards');
      element.classList.remove('is-dragging-card');
      placeholder.remove();
      restore(source);
      if (target && target !== source) restore(target);
      cancel.current = null;
    }

    event.dataTransfer.setData('text/plain', card.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(element, event.clientX - dragged.bounds.left, event.clientY - dragged.bounds.top);
    // Let Chromium capture the drag image before hiding the source card.
    const activate = requestAnimationFrame(() => {
      board.classList.add('is-sorting-cards');
      element.classList.add('is-dragging-card');
    });
    cancel.current = cleanup;
    document.addEventListener('dragover', event => {
      track(event);
      if (target && board.contains(event.target)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }
      if (!frame && velocity().some(Boolean)) frame = requestAnimationFrame(scroll);
    }, options);
    document.addEventListener('drop', event => {
      track(event);
      const destination = board.contains(event.target) ? target : null;
      const anchor = beforeId;
      if (destination) event.preventDefault();
      cleanup();
      if (destination) move.current(card, destination.id, anchor);
    }, options);
    document.addEventListener('dragend', cleanup, options);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') cleanup(); }, options);
    window.addEventListener('resize', cleanup, options);
  };
}
