/**
 * DOM utility functions for creating and manipulating elements.
 *
 * Provides a thin abstraction over DOM APIs with type safety
 * and consistent patterns.
 *
 * @module ui/utils/dom
 */

// ============================================================================
// Constants
// ============================================================================

const MAX_CHILDREN = 128;
const MAX_ATTRIBUTES = 32;
const MAX_CLASSES = 16;

// ============================================================================
// Types
// ============================================================================

export interface ElementAttributes {
  readonly id?: string;
  readonly className?: string;
  readonly textContent?: string;
  readonly innerHTML?: string;
  readonly type?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly readonly?: boolean;
  readonly min?: string;
  readonly max?: string;
  readonly step?: string;
  readonly name?: string;
  readonly for?: string;
  readonly colspan?: string;
  readonly rowspan?: string;
}

export interface EventHandlers {
  readonly onClick?: (event: MouseEvent) => void;
  readonly onInput?: (event: Event) => void;
  readonly onChange?: (event: Event) => void;
  readonly onSubmit?: (event: Event) => void;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
  readonly onKeyUp?: (event: KeyboardEvent) => void;
  readonly onFocus?: (event: FocusEvent) => void;
  readonly onBlur?: (event: FocusEvent) => void;
}

// ============================================================================
// Element Creation
// ============================================================================

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: ElementAttributes,
  handlers?: EventHandlers
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (attrs !== undefined) {
    applyAttributes(element, attrs);
  }

  if (handlers !== undefined) {
    applyHandlers(element, handlers);
  }

  return element;
}

export function createTextNode(text: string): Text {
  return document.createTextNode(text);
}

// ============================================================================
// Attribute Management
// ============================================================================

function applyAttributes(element: HTMLElement, attrs: ElementAttributes): void {
  if (attrs.id !== undefined) {
    element.id = attrs.id;
  }

  if (attrs.className !== undefined) {
    element.className = attrs.className;
  }

  if (attrs.textContent !== undefined) {
    element.textContent = attrs.textContent;
  }

  if (attrs.innerHTML !== undefined) {
    element.innerHTML = attrs.innerHTML;
  }

  if (attrs.type !== undefined && element instanceof HTMLInputElement) {
    element.type = attrs.type;
  }

  if (attrs.value !== undefined && 'value' in element) {
    (element as HTMLInputElement).value = attrs.value;
  }

  if (attrs.placeholder !== undefined && element instanceof HTMLInputElement) {
    element.placeholder = attrs.placeholder;
  }

  if (attrs.disabled !== undefined && 'disabled' in element) {
    (element as HTMLInputElement).disabled = attrs.disabled;
  }

  if (attrs.readonly !== undefined && element instanceof HTMLInputElement) {
    element.readOnly = attrs.readonly;
  }

  if (attrs.min !== undefined && element instanceof HTMLInputElement) {
    element.min = attrs.min;
  }

  if (attrs.max !== undefined && element instanceof HTMLInputElement) {
    element.max = attrs.max;
  }

  if (attrs.step !== undefined && element instanceof HTMLInputElement) {
    element.step = attrs.step;
  }

  if (attrs.name !== undefined && 'name' in element) {
    (element as HTMLInputElement).name = attrs.name;
  }

  if (attrs.for !== undefined && element instanceof HTMLLabelElement) {
    element.htmlFor = attrs.for;
  }

  if (attrs.colspan !== undefined && element instanceof HTMLTableCellElement) {
    element.colSpan = parseInt(attrs.colspan, 10);
  }

  if (attrs.rowspan !== undefined && element instanceof HTMLTableCellElement) {
    element.rowSpan = parseInt(attrs.rowspan, 10);
  }
}

function applyHandlers(element: HTMLElement, handlers: EventHandlers): void {
  if (handlers.onClick !== undefined) {
    element.addEventListener('click', handlers.onClick as EventListener);
  }

  if (handlers.onInput !== undefined) {
    element.addEventListener('input', handlers.onInput);
  }

  if (handlers.onChange !== undefined) {
    element.addEventListener('change', handlers.onChange);
  }

  if (handlers.onSubmit !== undefined) {
    element.addEventListener('submit', handlers.onSubmit);
  }

  if (handlers.onKeyDown !== undefined) {
    element.addEventListener('keydown', handlers.onKeyDown as EventListener);
  }

  if (handlers.onKeyUp !== undefined) {
    element.addEventListener('keyup', handlers.onKeyUp as EventListener);
  }

  if (handlers.onFocus !== undefined) {
    element.addEventListener('focus', handlers.onFocus as EventListener);
  }

  if (handlers.onBlur !== undefined) {
    element.addEventListener('blur', handlers.onBlur as EventListener);
  }
}

// ============================================================================
// Element Manipulation
// ============================================================================

export function appendChild(parent: HTMLElement, child: Node): void {
  parent.appendChild(child);
}

export function appendChildren(parent: HTMLElement, children: Node[]): void {
  const count = Math.min(children.length, MAX_CHILDREN);

  for (let i = 0; i < count; i += 1) {
    parent.appendChild(children[i]);
  }
}

export function removeChild(parent: HTMLElement, child: Node): void {
  if (child.parentNode === parent) {
    parent.removeChild(child);
  }
}

export function removeAllChildren(parent: HTMLElement): void {
  let iterations = 0;

  while (parent.firstChild !== null && iterations < MAX_CHILDREN) {
    parent.removeChild(parent.firstChild);
    iterations += 1;
  }
}

export function replaceChildren(parent: HTMLElement, children: Node[]): void {
  removeAllChildren(parent);
  appendChildren(parent, children);
}

export function insertBefore(
  parent: HTMLElement,
  newChild: Node,
  refChild: Node | null
): void {
  parent.insertBefore(newChild, refChild);
}

// ============================================================================
// Class Management
// ============================================================================

export function addClass(element: HTMLElement, className: string): void {
  element.classList.add(className);
}

export function removeClass(element: HTMLElement, className: string): void {
  element.classList.remove(className);
}

export function toggleClass(element: HTMLElement, className: string): void {
  element.classList.toggle(className);
}

export function hasClass(element: HTMLElement, className: string): boolean {
  return element.classList.contains(className);
}

export function setClasses(element: HTMLElement, classes: string[]): void {
  element.className = '';
  const count = Math.min(classes.length, MAX_CLASSES);

  for (let i = 0; i < count; i += 1) {
    element.classList.add(classes[i]);
  }
}

// ============================================================================
// Attribute Helpers
// ============================================================================

export function setAttribute(
  element: HTMLElement,
  name: string,
  value: string
): void {
  element.setAttribute(name, value);
}

export function getAttribute(
  element: HTMLElement,
  name: string
): string | null {
  return element.getAttribute(name);
}

export function removeAttribute(element: HTMLElement, name: string): void {
  element.removeAttribute(name);
}

export function setDataAttribute(
  element: HTMLElement,
  name: string,
  value: string
): void {
  element.dataset[name] = value;
}

export function getDataAttribute(
  element: HTMLElement,
  name: string
): string | undefined {
  return element.dataset[name];
}

// ============================================================================
// Style Helpers
// ============================================================================

export function setStyle(
  element: HTMLElement,
  property: string,
  value: string
): void {
  element.style.setProperty(property, value);
}

export function removeStyle(element: HTMLElement, property: string): void {
  element.style.removeProperty(property);
}

export function show(element: HTMLElement): void {
  element.style.display = '';
}

export function hide(element: HTMLElement): void {
  element.style.display = 'none';
}

export function isVisible(element: HTMLElement): boolean {
  return element.style.display !== 'none';
}

// ============================================================================
// Query Helpers
// ============================================================================

export function getById<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function query<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector(selector) as T | null;
}

export function queryAll<T extends HTMLElement>(selector: string): T[] {
  const nodeList = document.querySelectorAll(selector);
  const result: T[] = [];
  const count = Math.min(nodeList.length, MAX_CHILDREN);

  for (let i = 0; i < count; i += 1) {
    result.push(nodeList[i] as T);
  }

  return result;
}

// ============================================================================
// Input Helpers
// ============================================================================

export function getInputValue(element: HTMLInputElement): string {
  return element.value;
}

export function setInputValue(element: HTMLInputElement, value: string): void {
  element.value = value;
}

export function getSelectValue(element: HTMLSelectElement): string {
  return element.value;
}

export function setSelectValue(element: HTMLSelectElement, value: string): void {
  element.value = value;
}

export function getNumericValue(element: HTMLInputElement): number | null {
  const value = element.value.trim();
  if (value === '') {
    return null;
  }

  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function getIntegerValue(element: HTMLInputElement): number | null {
  const value = element.value.trim();
  if (value === '') {
    return null;
  }

  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

// ============================================================================
// Focus Helpers
// ============================================================================

export function focus(element: HTMLElement): void {
  element.focus();
}

export function blur(element: HTMLElement): void {
  element.blur();
}

// ============================================================================
// Table Helpers
// ============================================================================

export function createTableRow(cells: string[], isHeader?: boolean): HTMLTableRowElement {
  const row = createElement('tr');
  const cellTag = isHeader === true ? 'th' : 'td';
  const count = Math.min(cells.length, MAX_CHILDREN);

  for (let i = 0; i < count; i += 1) {
    const cell = createElement(cellTag, { textContent: cells[i] });
    row.appendChild(cell);
  }

  return row;
}

export function createTableRowWithElements(
  cells: HTMLElement[],
  isHeader?: boolean
): HTMLTableRowElement {
  const row = createElement('tr');
  const cellTag = isHeader === true ? 'th' : 'td';
  const count = Math.min(cells.length, MAX_CHILDREN);

  for (let i = 0; i < count; i += 1) {
    const cell = createElement(cellTag);
    cell.appendChild(cells[i]);
    row.appendChild(cell);
  }

  return row;
}

export function updateTableCell(
  row: HTMLTableRowElement,
  cellIndex: number,
  content: string
): void {
  const cell = row.cells[cellIndex];
  if (cell !== undefined) {
    cell.textContent = content;
  }
}
