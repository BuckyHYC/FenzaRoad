import type { InputSystem } from '../systems/InputSystem';

function el(tag: keyof HTMLElementTagNameMap, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class TouchControls {
  private readonly input: InputSystem;
  private readonly root: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly joystickPointers = new Map<number, { x: number; y: number }>();
  private activePointerId: number | null = null;
  private moveX = 0;
  private moveZ = 0;
  private throttle = false;
  private brake = false;
  private handbrake = false;
  private readonly maxRadius = 46;

  constructor(input: InputSystem, parent: HTMLElement) {
    this.input = input;
    this.root = el('div', 'touch-controls') as HTMLDivElement;
    this.base = el('div', 'joystick-base') as HTMLDivElement;
    this.knob = el('div', 'joystick-knob') as HTMLDivElement;
    this.base.appendChild(this.knob);
    this.root.appendChild(this.base);

    this.root.appendChild(this.makeButton('油门', () => { this.throttle = true; this.sync(); }, () => { this.throttle = false; this.sync(); }, 'pedal pedal-throttle'));
    this.root.appendChild(this.makeButton('刹车', () => { this.brake = true; this.sync(); }, () => { this.brake = false; this.sync(); }, 'pedal pedal-brake'));
    this.root.appendChild(this.makeButton('手刹', () => { this.handbrake = true; this.sync(); }, () => { this.handbrake = false; this.sync(); }, 'pedal pedal-handbrake'));
    const camBtn = el('button', 'cam-btn', '视角') as HTMLButtonElement;
    camBtn.setAttribute('aria-label', '切换视角');
    camBtn.addEventListener('click', () => {
      this.input.trigger('camera');
    });
    this.root.appendChild(camBtn);

    this.base.addEventListener('pointerdown', this.onPointerDown);
    this.base.addEventListener('pointermove', this.onPointerMove);
    this.base.addEventListener('pointerup', this.onPointerUp);
    this.base.addEventListener('pointercancel', this.onPointerUp);

    this.root.style.display = 'none';
    parent.appendChild(this.root);
  }

  show(): void {
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.joystickPointers.clear();
    this.activePointerId = null;
    this.moveX = 0;
    this.moveZ = 0;
    this.throttle = false;
    this.brake = false;
    this.handbrake = false;
    this.input.setTouch(0, 0, false);
  }

  private makeButton(
    label: string,
    onDown: () => void,
    onUp: () => void,
    className: string,
  ): HTMLButtonElement {
    const button = el('button', className, label) as HTMLButtonElement;
    const pointers = new Set<number>();
    const press = (event: PointerEvent): void => {
      event.preventDefault();
      if (pointers.size === 0) onDown();
      pointers.add(event.pointerId);
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers have no active capture; normal touch still works.
      }
    };
    const release = (event: PointerEvent): void => {
      if (!pointers.delete(event.pointerId)) return;
      if (pointers.size === 0) onUp();
    };
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', (event) => {
      if (button.hasPointerCapture(event.pointerId)) return;
      release(event);
    });
    button.addEventListener('lostpointercapture', release);
    return button;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.joystickPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    try {
      this.base.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers have no active capture; normal touch still works.
    }
    this.updateFromEvent(event);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.activePointerId !== event.pointerId) return;
    this.joystickPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.updateFromEvent(event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.joystickPointers.delete(event.pointerId)) return;
    if (this.activePointerId !== event.pointerId) return;
    this.activePointerId = null;
    const next = this.joystickPointers.keys().next();
    if (!next.done) {
      this.activePointerId = next.value;
      const point = this.joystickPointers.get(next.value);
      if (point) this.updateFromPoint(point.x, point.y);
      return;
    }
    this.moveX = 0;
    this.moveZ = 0;
    this.knob.style.transform = 'translate(0, 0)';
    this.sync();
  };

  private updateFromEvent(event: PointerEvent): void {
    this.updateFromPoint(event.clientX, event.clientY);
  }

  private updateFromPoint(clientX: number, clientY: number): void {
    const rect = this.base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > this.maxRadius) {
      dx = (dx / dist) * this.maxRadius;
      dy = (dy / dist) * this.maxRadius;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Screen right must turn the vehicle right; vehicle physics uses positive steer as left turn.
    this.moveX = -dx / this.maxRadius;
    this.moveZ = -dy / this.maxRadius;
    this.sync();
  }

  private sync(): void {
    const mz = this.throttle ? 1 : this.brake ? -0.85 : this.moveZ;
    this.input.setTouch(this.moveX, mz, this.handbrake);
  }
}
