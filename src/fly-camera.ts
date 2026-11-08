import {
    AppBase,
    Entity,
    EVENT_MOUSEDOWN,
    EVENT_MOUSEMOVE,
    EVENT_MOUSEUP,
    EventHandle,
    KEY_A,
    KEY_D,
    KEY_DOWN,
    KEY_LEFT,
    KEY_RIGHT,
    KEY_S,
    KEY_SHIFT,
    KEY_SPACE,
    KEY_UP,
    KEY_W,
    math,
    MOUSEBUTTON_MIDDLE,
    MOUSEBUTTON_RIGHT,
    MouseEvent,
    Vec3,
} from 'playcanvas';
import { TouchJoysticks } from './touch-joysticks.ts';

const LOOK_SPEED = 150;
const LOOK_SMOOTH = 0.1;
const MOVE_SMOOTH = 0.18;
const PAN_SCALE = 5;

export interface FlyCameraOptions {
    speed?: number;
    slowSpeed?: number;
    fastSpeed?: number;
    sensitivity?: number;
    onDebugStep?: (delta: number) => void;
}

export class FlyCamera {

    private readonly _app: AppBase;
    private readonly _entity: Entity;
    private readonly _speed: number;
    private readonly _slowSpeed: number;
    private readonly _fastSpeed: number;
    private readonly _sensitivity: number;
    private readonly _translate = new Vec3();
    private readonly _joysticks: TouchJoysticks;
    private _pitch: number;
    private _yaw: number;
    private _moveX = 0;
    private _moveZ = 0;
    private _pitchRate = 0;
    private _yawRate = 0;
    private _moved = false;
    private _rightDown = false;
    private _middleDown = false;
    private _updateHandle: EventHandle | null = null;

    public constructor(app: AppBase, entity: Entity, options: FlyCameraOptions = {}) {
        this._app = app;
        this._entity = entity;
        this._speed = options.speed ?? 20;
        this._slowSpeed = options.slowSpeed ?? 4;
        this._fastSpeed = options.fastSpeed ?? 60;
        this._sensitivity = options.sensitivity ?? 5;
        this._joysticks = new TouchJoysticks(options.onDebugStep);

        const eulers = entity.getLocalEulerAngles();
        this._pitch = eulers.x;
        this._yaw = eulers.y;

        const mouse = app.mouse;
        if (mouse) {
            mouse.disableContextMenu();
            mouse.on(EVENT_MOUSEMOVE, this._onMouseMove, this);
            mouse.on(EVENT_MOUSEDOWN, this._onMouseDown, this);
            mouse.on(EVENT_MOUSEUP, this._onMouseUp, this);
        }

        this._updateHandle = app.on('update', this.update, this);
    }

    public destroy(): void {
        this._updateHandle?.off();
        this._updateHandle = null;
        this._joysticks.destroy();

        const mouse = this._app.mouse;
        if (mouse) {
            mouse.off(EVENT_MOUSEMOVE, this._onMouseMove, this);
            mouse.off(EVENT_MOUSEDOWN, this._onMouseDown, this);
            mouse.off(EVENT_MOUSEUP, this._onMouseUp, this);
        }
    }

    public update(dt: number): void {
        const speed = this._moveSpeed();
        this._addKeyboardMove(dt, speed);
        this._applyJoysticks(dt);
        this._entity.setLocalEulerAngles(this._pitch, this._yaw, 0);
        this._entity.translateLocal(this._translate);
        this._translate.set(0, 0, 0);
    }

    private _moveSpeed(): number {
        const keyboard = this._app.keyboard;
        if (keyboard?.isPressed(KEY_SHIFT)) {
            return this._fastSpeed;
        }
        if (keyboard?.isPressed(KEY_SPACE)) {
            return this._slowSpeed;
        }
        return this._speed;
    }

    private _addKeyboardMove(dt: number, speed: number): void {
        const keyboard = this._app.keyboard;
        if (!keyboard) {
            return;
        }

        const step = speed * dt;
        if (keyboard.isPressed(KEY_UP) || keyboard.isPressed(KEY_W)) {
            this._translate.z -= step;
        } else if (keyboard.isPressed(KEY_DOWN) || keyboard.isPressed(KEY_S)) {
            this._translate.z += step;
        }

        if (keyboard.isPressed(KEY_LEFT) || keyboard.isPressed(KEY_A)) {
            this._translate.x -= step;
        } else if (keyboard.isPressed(KEY_RIGHT) || keyboard.isPressed(KEY_D)) {
            this._translate.x += step;
        }
    }

    private _applyJoysticks(dt: number): void {
        const move = this._joysticks.move;
        const moveAmount = Math.hypot(move.x, move.y);
        let targetX = 0;
        let targetZ = 0;
        if (moveAmount > 0) {
            const stickSpeed = math.lerp(this._speed, this._fastSpeed, Math.min(1, moveAmount));
            targetX = move.x * stickSpeed;
            targetZ = -move.y * stickSpeed;
        }

        this._moveX = this._ease(this._moveX, targetX, dt, MOVE_SMOOTH);
        this._moveZ = this._ease(this._moveZ, targetZ, dt, MOVE_SMOOTH);
        this._translate.x += this._moveX * dt;
        this._translate.z += this._moveZ * dt;

        const look = this._joysticks.look;
        this._pitchRate = this._ease(this._pitchRate, look.y * LOOK_SPEED, dt, LOOK_SMOOTH);
        this._yawRate = this._ease(this._yawRate, -look.x * LOOK_SPEED, dt, LOOK_SMOOTH);
        if (this._pitchRate !== 0 || this._yawRate !== 0) {
            this._look(this._pitchRate * dt, this._yawRate * dt);
        }
    }

    private _ease(current: number, target: number, dt: number, smoothTime: number): number {
        const next = current + (target - current) * (1 - Math.exp(-dt / smoothTime));
        return target === 0 && Math.abs(next) < 0.02 ? 0 : next;
    }

    private _look(pitchDelta: number, yawDelta: number): void {
        this._pitch = math.clamp(this._pitch + pitchDelta, -90, 90);
        this._yaw += yawDelta;
    }

    private _onMouseMove = (event: MouseEvent): void => {
        if (!this._rightDown && !this._middleDown) {
            return;
        }

        // The first drag sample often carries a stale delta. Later drags are kept.
        if (!this._moved) {
            this._moved = true;
            return;
        }

        if (this._rightDown) {
            this._look(-event.dy / this._sensitivity, -event.dx / this._sensitivity);
        }

        if (this._middleDown) {
            const speed = this._app.keyboard?.isPressed(KEY_SHIFT) ? this._fastSpeed : this._speed;
            this._translate.x -= (event.dx / PAN_SCALE) * speed;
            this._translate.y += (event.dy / PAN_SCALE) * speed;
        }
    };

    private _onMouseDown = (event: MouseEvent): void => {
        if (event.button === MOUSEBUTTON_RIGHT) {
            this._rightDown = true;
        }
        if (event.button === MOUSEBUTTON_MIDDLE) {
            this._middleDown = true;
        }
    };

    private _onMouseUp = (event: MouseEvent): void => {
        if (event.button === MOUSEBUTTON_RIGHT) {
            this._rightDown = false;
        }
        if (event.button === MOUSEBUTTON_MIDDLE) {
            this._middleDown = false;
        }
    };
}
