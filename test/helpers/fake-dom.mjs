// 疑似DOM（ブラウザなしで画面を操作するテスト用）
class Node_ { }
class El extends Node_ {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.value = ''; this.disabled = false; this.classes = new Set(); this.parent = null; }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  get classList() { return { toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)), add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c) }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  append(...cs) { for (const c of cs) { if (c instanceof El) c.parent = this; this.children.push(c); } }
  replaceChildren(...cs) { this.children = []; this.append(...cs); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  focus() {}
  get text() { return this.children.map((c) => (typeof c === 'string' ? c : c.text)).join(''); }
  all(pred, out = []) { for (const c of this.children) if (c instanceof El) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  click() { for (const f of this.listeners.click || []) f({}); }
}
globalThis.Node = Node_;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (s) => String(s), body: new El('body') };
globalThis.window = { scrollTo() {} };
globalThis.setTimeout = () => 0; // toast のアニメーション用
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.location = { hash: '' };

