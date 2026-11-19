// Tiny inline formatter for hand-written puzzle text: escape HTML, then `code`.
export const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const md = (t = '') => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');
