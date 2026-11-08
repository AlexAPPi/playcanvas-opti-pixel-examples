import { t } from './i18n.ts';
import { coveragePreviewQuads } from './occlusion/coverage-preview.ts';

const STICK_SIZE = 136;
const STICK_RADIUS = 50;
const STICK_GAP = 14;
const DEADZONE = 0.16;
const EDGE_MARGIN = 18;
const MIN_STICK_SIZE = 104;
const MIN_TOP = 8;
const STEP_BUTTON = 52;
const STEP_GAP = 8;
const STEP_REPEAT_DELAY = 380;
const STEP_REPEAT_INTERVAL = 110;
const STATS_MIN_EXTENT = 40;
const PANEL_BOTTOM_GAP = 36;
const MIN_PANEL_HEIGHT = 48;

interface Box {
    x: number;
    y: number;
    r: number;
    b: number;
}

type StickId = 'move' | 'look';

interface StickVector {
    x: number;
    y: number;
}

interface StickState {
    readonly id: StickId;
    readonly element: HTMLDivElement;
    readonly knob: HTMLDivElement;
    readonly vector: StickVector;
    pointerId: number | null;
    originX: number;
    originY: number;
}

interface StepButton {
    readonly element: HTMLButtonElement;
    readonly delta: number;
    pointerId: number | null;
    delay: number;
    repeat: number;
}

export class TouchJoysticks {

    public readonly move: StickVector = { x: 0, y: 0 };
    public readonly look: StickVector = { x: 0, y: 0 };

    private readonly _coarseQuery = window.matchMedia('(pointer: coarse), (hover: none)');
    private readonly _moveStick: StickState;
    private readonly _lookStick: StickState;
    private readonly _stepNext: StepButton;
    private readonly _stepPrev: StepButton;
    private readonly _safeProbe: HTMLDivElement;
    private readonly _domObserver: MutationObserver;
    private _statsObserver: ResizeObserver | null = null;
    private _statsElement: HTMLElement | null = null;
    private _coarse = this._coarseQuery.matches;
    private _onDebugStep: ((delta: number) => void) | null;

    public constructor(onDebugStep?: (delta: number) => void) {
        this._onDebugStep = onDebugStep ?? null;
        this._moveStick = this._createStick('move', this.move);
        this._lookStick = this._createStick('look', this.look);
        this._stepNext = this._createStepButton(1, 'debugNext', '+');
        this._stepPrev = this._createStepButton(-1, 'debugPrev', '−');
        this._safeProbe = document.createElement('div');
        this._safeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
        document.body.append(
            this._moveStick.element,
            this._lookStick.element,
            this._stepNext.element,
            this._stepPrev.element,
            this._safeProbe,
        );
        this._layoutIdle();
        this._syncIdleVisibility();

        document.addEventListener('pointerdown', this._onPointerDown, { capture: true, passive: false });
        document.addEventListener('pointermove', this._onPointerMove, { capture: true, passive: false });
        document.addEventListener('pointerup', this._onPointerUp, { capture: true });
        document.addEventListener('pointercancel', this._onPointerUp, { capture: true });
        document.addEventListener('lostpointercapture', this._onLostCapture, { capture: true });
        window.addEventListener('blur', this._resetAll);
        window.addEventListener('resize', this._onResize);
        document.addEventListener('visibilitychange', this._onVisibility);
        this._coarseQuery.addEventListener('change', this._onCoarseChange);
        document.querySelector('#draw-hzb')?.addEventListener('change', this._onResize);
        this._domObserver = new MutationObserver(() => this._watchStats());
        this._domObserver.observe(document.body, { childList: true });
        this._watchStats();
    }

    public destroy(): void {
        document.removeEventListener('pointerdown', this._onPointerDown, { capture: true });
        document.removeEventListener('pointermove', this._onPointerMove, { capture: true });
        document.removeEventListener('pointerup', this._onPointerUp, { capture: true });
        document.removeEventListener('pointercancel', this._onPointerUp, { capture: true });
        document.removeEventListener('lostpointercapture', this._onLostCapture, { capture: true });
        window.removeEventListener('blur', this._resetAll);
        window.removeEventListener('resize', this._onResize);
        document.removeEventListener('visibilitychange', this._onVisibility);
        this._coarseQuery.removeEventListener('change', this._onCoarseChange);
        document.querySelector('#draw-hzb')?.removeEventListener('change', this._onResize);
        document.querySelector<HTMLElement>('#panel')?.style.removeProperty('max-height');
        this._domObserver.disconnect();
        this._statsObserver?.disconnect();
        document.documentElement.style.removeProperty('--stick-clearance');
        this._endRepeat(this._stepNext);
        this._endRepeat(this._stepPrev);
        this._moveStick.element.remove();
        this._lookStick.element.remove();
        this._stepNext.element.remove();
        this._stepPrev.element.remove();
        this._safeProbe.remove();
    }

    private _createStick(id: StickId, vector: StickVector): StickState {
        const element = document.createElement('div');
        element.className = `joystick joystick-${id}`;
        element.dataset.stick = id;
        element.hidden = true;

        const labelKey = id === 'move' ? 'joystickMove' : 'joystickLook';
        const caption = document.createElement('span');
        caption.className = 'joystick-label';
        caption.dataset.i18n = labelKey;
        caption.textContent = t(labelKey);

        const knob = document.createElement('div');
        knob.className = 'joystick-knob';
        element.append(caption, knob);

        return {
            id,
            element,
            knob,
            vector,
            pointerId: null,
            originX: 0,
            originY: 0,
        };
    }

    private _createStepButton(delta: number, labelKey: 'debugNext' | 'debugPrev', glyph: string): StepButton {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'debug-step';
        element.hidden = true;
        element.dataset.i18nAria = labelKey;
        element.setAttribute('aria-label', t(labelKey));
        element.textContent = glyph;

        const button: StepButton = {
            element,
            delta,
            pointerId: null,
            delay: 0,
            repeat: 0,
        };
        element.addEventListener('pointerdown', (event) => {
            this._onStepPointerDown(button, event);
        });
        element.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
        return button;
    }

    private _onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === 'mouse' || event.button !== 0) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element) || this._isUiTarget(target)) {
            return;
        }

        const stickElement = target.closest<HTMLElement>('.joystick');
        const stick = this._stickForEvent(stickElement, event.clientX);
        if (stick.pointerId !== null) {
            return;
        }

        if (event.cancelable) {
            event.preventDefault();
        }

        const rect = stickElement?.getBoundingClientRect();
        const originX = rect ? rect.left + rect.width / 2 : event.clientX;
        const originY = rect ? rect.top + rect.height / 2 : event.clientY;
        stick.pointerId = event.pointerId;
        this._positionActive(stick, originX, originY);
        this._updateStick(stick, event.clientX, event.clientY);

        try {
            (stickElement ?? target).setPointerCapture(event.pointerId);
        } catch {
            // Pointer can already be released.
        }
    };

    private _onPointerMove = (event: PointerEvent): void => {
        const stick = this._stickByPointer(event.pointerId);
        if (!stick) {
            return;
        }

        if (event.cancelable) {
            event.preventDefault();
        }

        this._updateStick(stick, event.clientX, event.clientY);
    };

    private _onPointerUp = (event: PointerEvent): void => {
        this._release(event.pointerId);
        this._endStepPointer(event.pointerId);
    };

    private _onLostCapture = (event: PointerEvent): void => {
        this._release(event.pointerId);
        const target = event.target;
        if (target instanceof Element && target.closest('.debug-step')) {
            this._endStepPointer(event.pointerId);
        }
    };

    private _onVisibility = (): void => {
        if (document.visibilityState === 'hidden') {
            this._resetAll();
        }
    };

    private _onCoarseChange = (): void => {
        this._coarse = this._coarseQuery.matches;
        this._layoutIdle();
        this._syncIdleVisibility();
    };

    private _onResize = (): void => {
        this._layoutIdle();
    };

    private _resetAll = (): void => {
        this._release(this._moveStick.pointerId);
        this._release(this._lookStick.pointerId);
        this._endRepeat(this._stepNext);
        this._endRepeat(this._stepPrev);
    };

    private _release(pointerId: number | null): void {
        if (pointerId === null) {
            return;
        }

        for (const stick of [this._moveStick, this._lookStick]) {
            if (stick.pointerId !== pointerId) {
                continue;
            }

            stick.pointerId = null;
            stick.vector.x = 0;
            stick.vector.y = 0;
            stick.knob.style.transform = '';
            stick.element.classList.remove('is-active');
            stick.element.hidden = !this._coarse;
            this._layoutIdle();
        }
    }

    private _positionActive(stick: StickState, centerX: number, centerY: number): void {
        const size = stick.element.offsetWidth || STICK_SIZE;
        const half = size / 2;
        const x = Math.min(window.innerWidth - half, Math.max(half, centerX));
        const y = Math.min(window.innerHeight - half, Math.max(half, centerY));
        stick.originX = x;
        stick.originY = y;
        stick.element.hidden = false;
        stick.element.classList.add('is-active');
        stick.element.style.left = `${x - half}px`;
        stick.element.style.top = `${y - half}px`;
        stick.element.style.right = 'auto';
        stick.element.style.bottom = 'auto';
    }

    private _layoutIdle(): void {
        const safe = this._safeArea();
        const width = window.innerWidth;
        const height = window.innerHeight;
        const size = this._idleStickSize(width);
        const lookLeft = width - safe.right - EDGE_MARGIN - size;
        const bottomTop = height - safe.bottom - EDGE_MARGIN - size;
        const obstacles = this._bufferMapsVisible() ? this._bufferQuads(width, height) : [];
        const move = this._moveIdleOrigin(safe.left, size, lookLeft, bottomTop);

        const moveTop = this._liftAbove(move.left, move.top, size, obstacles);
        const lookTop = this._liftAbove(Math.max(MIN_TOP, lookLeft), bottomTop, size, obstacles);
        const placedLookLeft = Math.max(MIN_TOP, lookLeft);
        this._placeIdle(this._moveStick, move.left, moveTop, size);
        this._placeIdle(this._lookStick, placedLookLeft, lookTop, size);
        this._fitPanel(Math.min(moveTop, lookTop));
        this._layoutStepper(placedLookLeft, lookTop, size, move.left, moveTop, obstacles);
    }

    private _idleStickSize(width: number): number {
        const room = Math.floor((width - EDGE_MARGIN * 2 - STICK_GAP) / 2);
        return Math.max(MIN_STICK_SIZE, Math.min(STICK_SIZE, room));
    }

    private _moveIdleOrigin(
        safeLeft: number,
        size: number,
        lookLeft: number,
        bottomTop: number,
    ): { left: number; top: number } {
        let left = safeLeft + EDGE_MARGIN;
        let top = bottomTop;
        const stats = this._statsElement?.getBoundingClientRect();
        const statsBox = stats && stats.width > STATS_MIN_EXTENT && stats.height > STATS_MIN_EXTENT ? stats : null;
        if (!statsBox) {
            return { left, top };
        }

        const besideLeft = Math.max(left, statsBox.right + STICK_GAP);
        if (besideLeft + size + STICK_GAP <= lookLeft) {
            left = besideLeft;
        } else {
            top = Math.max(MIN_TOP, statsBox.top - STICK_GAP - size);
        }
        return { left, top };
    }

    private _liftAbove(left: number, top: number, size: number, obstacles: readonly Box[]): number {
        const stick = { x: left, y: top, r: left + size, b: top + size };
        const hit = obstacles.filter((obstacle) => this._intersects(stick, obstacle));
        if (hit.length === 0) {
            return top;
        }

        const ceiling = Math.min(...hit.map((obstacle) => obstacle.y));
        return Math.max(MIN_TOP, ceiling - STICK_GAP - size);
    }

    private _fitPanel(stickTop: number): void {
        const panel = document.querySelector<HTMLElement>('#panel');
        if (!panel) {
            return;
        }

        if (!this._coarse) {
            panel.style.removeProperty('max-height');
            return;
        }

        panel.style.maxHeight = `${Math.max(MIN_PANEL_HEIGHT, Math.floor(stickTop - PANEL_BOTTOM_GAP))}px`;
    }

    private _bufferMapsVisible(): boolean {
        const toggle = document.querySelector<HTMLInputElement>('#draw-hzb');
        return toggle?.checked ?? false;
    }

    private _bufferQuads(width: number, height: number): Box[] {
        return coveragePreviewQuads.map((quad) => {
            const halfWidth = quad.width / 2;
            const halfHeight = quad.height / 2;
            return {
                x: (quad.centerX - halfWidth + 1) / 2 * width,
                r: (quad.centerX + halfWidth + 1) / 2 * width,
                y: (1 - (quad.centerY + halfHeight)) / 2 * height,
                b: (1 - (quad.centerY - halfHeight)) / 2 * height,
            };
        });
    }

    private _intersects(a: Box, b: Box): boolean {
        return a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
    }

    private _placeIdle(stick: StickState, left: number, top: number, size: number): void {
        if (stick.pointerId !== null) {
            return;
        }

        stick.element.style.width = `${size}px`;
        stick.element.style.height = `${size}px`;
        stick.element.style.left = `${left}px`;
        stick.element.style.top = `${top}px`;
        stick.element.style.right = 'auto';
        stick.element.style.bottom = 'auto';
    }

    private _watchStats(): void {
        const stats = document.querySelector('#mini-stats');
        if (!(stats instanceof HTMLElement) || stats === this._statsElement) {
            return;
        }

        this._statsElement = stats;
        this._statsObserver?.disconnect();
        this._statsObserver = new ResizeObserver(() => this._layoutIdle());
        this._statsObserver.observe(stats);
        this._layoutIdle();
    }

    private _safeArea(): { left: number; right: number; bottom: number } {
        const style = getComputedStyle(this._safeProbe);
        return {
            left: Number.parseFloat(style.paddingLeft) || 0,
            right: Number.parseFloat(style.paddingRight) || 0,
            bottom: Number.parseFloat(style.paddingBottom) || 0,
        };
    }

    private _updateStick(stick: StickState, clientX: number, clientY: number): void {
        const size = stick.element.offsetWidth || STICK_SIZE;
        const radius = size * (STICK_RADIUS / STICK_SIZE);
        let dx = clientX - stick.originX;
        let dy = clientY - stick.originY;
        const distance = Math.hypot(dx, dy);
        if (distance > radius) {
            dx = dx / distance * radius;
            dy = dy / distance * radius;
        }

        stick.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const output = this._applyDeadzone(dx / radius, -dy / radius);
        stick.vector.x = output.x;
        stick.vector.y = output.y;
    }

    private _applyDeadzone(x: number, y: number): StickVector {
        const amount = Math.hypot(x, y);
        if (amount <= DEADZONE || amount === 0) {
            return { x: 0, y: 0 };
        }

        const scaled = Math.min(1, (amount - DEADZONE) / (1 - DEADZONE));
        return {
            x: x / amount * scaled,
            y: y / amount * scaled,
        };
    }

    private _stickForEvent(stickElement: HTMLElement | null, clientX: number): StickState {
        if (stickElement?.dataset.stick === 'move') {
            return this._moveStick;
        }

        if (stickElement?.dataset.stick === 'look') {
            return this._lookStick;
        }

        return clientX < window.innerWidth * 0.5 ? this._moveStick : this._lookStick;
    }

    private _stickByPointer(pointerId: number): StickState | null {
        if (this._moveStick.pointerId === pointerId) {
            return this._moveStick;
        }

        if (this._lookStick.pointerId === pointerId) {
            return this._lookStick;
        }

        return null;
    }

    private _syncIdleVisibility(): void {
        for (const stick of [this._moveStick, this._lookStick]) {
            if (stick.pointerId === null) {
                stick.element.hidden = !this._coarse;
            }
        }
        for (const button of [this._stepNext, this._stepPrev]) {
            if (button.pointerId === null) {
                button.element.hidden = !this._coarse;
            }
        }
    }

    private _layoutStepper(
        lookLeft: number,
        lookTop: number,
        stickSize: number,
        moveLeft: number,
        moveTop: number,
        obstacles: readonly Box[],
    ): void {
        const button = STEP_BUTTON;
        const stack = button * 2 + STEP_GAP;
        const width = window.innerWidth;
        const height = window.innerHeight;
        let left = lookLeft + stickSize - button;
        let top = lookTop - STEP_GAP - stack;
        const fps = document.querySelector('#fps');
        const fpsBottom = fps instanceof HTMLElement ? fps.getBoundingClientRect().bottom : 0;
        const minTop = Math.max(MIN_TOP, Math.ceil(fpsBottom) + STEP_GAP);
        top = Math.max(minTop, top);

        const blocked: Box[] = [
            ...obstacles,
            { x: lookLeft, y: lookTop, r: lookLeft + stickSize, b: lookTop + stickSize },
            { x: moveLeft, y: moveTop, r: moveLeft + stickSize, b: moveTop + stickSize },
        ];
        const panel = document.querySelector('#panel');
        if (panel instanceof HTMLElement) {
            const rect = panel.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                blocked.push({ x: rect.left, y: rect.top, r: rect.right, b: rect.bottom });
            }
        }

        const placed = this._clearStepper(
            { x: left, y: top, r: left + button, b: top + stack },
            blocked,
            width,
            height,
            minTop,
        );
        this._placeStepButton(this._stepNext, placed.x, placed.y, button);
        this._placeStepButton(this._stepPrev, placed.x, placed.y + button + STEP_GAP, button);
    }

    private _clearStepper(box: Box, blocked: readonly Box[], width: number, height: number, minTop: number): Box {
        let next = box;
        for (let attempt = 0; attempt < 4; attempt++) {
            const hit = blocked.find((obstacle) => this._intersects(next, obstacle));
            if (!hit) {
                break;
            }

            const stack = next.b - next.y;
            const above = hit.y - STEP_GAP - stack;
            if (above >= minTop) {
                next = { x: next.x, y: above, r: next.r, b: above + stack };
                continue;
            }

            const buttonWidth = next.r - next.x;
            const toLeft = hit.x - STEP_GAP - buttonWidth;
            if (toLeft >= EDGE_MARGIN) {
                next = { x: toLeft, y: next.y, r: toLeft + buttonWidth, b: next.b };
                continue;
            }
            break;
        }

        const buttonWidth = next.r - next.x;
        const stack = next.b - next.y;
        const left = Math.max(EDGE_MARGIN, Math.min(next.x, width - EDGE_MARGIN - buttonWidth));
        const top = Math.max(minTop, Math.min(next.y, height - EDGE_MARGIN - stack));
        return { x: left, y: top, r: left + buttonWidth, b: top + stack };
    }

    private _placeStepButton(button: StepButton, left: number, top: number, size: number): void {
        const element = button.element;
        element.style.width = `${size}px`;
        element.style.height = `${size}px`;
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.style.right = 'auto';
        element.style.bottom = 'auto';
    }

    private _onStepPointerDown(button: StepButton, event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        this._endRepeat(button);
        button.pointerId = event.pointerId;
        button.element.classList.add('is-active');
        try {
            button.element.setPointerCapture(event.pointerId);
        } catch {
            // Pointer can already be released.
        }
        this._emitStep(button.delta);
        button.delay = window.setTimeout(() => {
            button.repeat = window.setInterval(() => {
                this._emitStep(button.delta);
            }, STEP_REPEAT_INTERVAL);
        }, STEP_REPEAT_DELAY);
    }

    private _endStepPointer(pointerId: number): void {
        for (const button of [this._stepNext, this._stepPrev]) {
            if (button.pointerId === pointerId) {
                this._endRepeat(button);
            }
        }
    }

    private _endRepeat(button: StepButton): void {
        window.clearTimeout(button.delay);
        window.clearInterval(button.repeat);
        button.delay = 0;
        button.repeat = 0;
        button.pointerId = null;
        button.element.classList.remove('is-active');
    }

    private _emitStep(delta: number): void {
        this._onDebugStep?.(delta);
    }

    private _isUiTarget(target: Element): boolean {
        if (target.closest('.joystick')) {
            return false;
        }

        return target.closest('#panel, #mini-stats, button, a, input, select, textarea, label') !== null;
    }
}
