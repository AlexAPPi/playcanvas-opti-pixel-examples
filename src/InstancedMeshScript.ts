import {
    HierarchicalInstancer
} from "playcanvas-opti-pixel";

export const LODLevelSchema = [
    {
        name: 'distance',
        type: 'number',
        min: 0,
        default: 0
    },
    {
        name: 'hysteresis',
        type: 'number',
        default: 0
    },
];

export interface ILODLevel {
    distance: number,
    hysteresis: number
}

const posRanges = {
    minX: -400, maxX: 400,
    minY: 0, maxY: 0,
    minZ: -400, maxZ: 400
}

const scaleRanges = {
    minX: 1, maxX: 4,
    minY: 1, maxY: 4,
    minZ: 1, maxZ: 4
}

const rotRanges = {
    minX: 0, maxX: 0,
    minY: 0, maxY: 0,
    minZ: 0, maxZ: 0
}

const tmpPos = new pc.Vec3();
const tmpRo3 = new pc.Vec3();
const tmpRot = new pc.Quat();
const tmpScl = new pc.Vec3();
const tmpMat = new pc.Mat4();

function randomRange(min: number, max: number) {
    return min + Math.random() * (max - min);
}

function generateRandomTransform() {
    const pos = tmpPos.set(
        randomRange(posRanges.minX, posRanges.maxX),
        randomRange(posRanges.minY, posRanges.maxY),
        randomRange(posRanges.minZ, posRanges.maxZ)
    );
    const scale = tmpRo3.set(
        randomRange(scaleRanges.minX, scaleRanges.maxX),
        randomRange(scaleRanges.minY, scaleRanges.maxY),
        randomRange(scaleRanges.minZ, scaleRanges.maxZ)
    );
    const euler = tmpScl.set(
        randomRange(rotRanges.minX, rotRanges.maxX),
        randomRange(rotRanges.minY, rotRanges.maxY),
        randomRange(rotRanges.minZ, rotRanges.maxZ)
    );
    
    const quat = tmpRot.setFromEulerAngles(euler.x, euler.y, euler.z);
    tmpMat.setTRS(pos, quat, scale);
    return tmpMat;
}

export class InstancedMeshScript extends pc.ScriptType {

    public declare autoRender: boolean;
    public declare cameraEntity: pc.Entity;
    public declare LODEntity: pc.Entity[];
    public declare LODLevel: ILODLevel[];

    private _meshInstancer: HierarchicalInstancer | undefined;
    private _dt: number = 0;

    public initialize(): void {

        const children = this.entity.children;
        const capacity = 20000;//children.length; // 100000
        const numLevels = this.LODLevel.length;

        this._meshInstancer = new HierarchicalInstancer(this.app.graphicsDevice, { capacity });

        for (let level = 0; level < numLevels; level++) {

            const lodLevel = this.LODLevel[level];
            const lodEntity = this.LODEntity[level];

            let meshInstances: pc.MeshInstance[] = [];

            if (lodEntity) {

                const lodEntityRenders = lodEntity.findComponents("render") as unknown as pc.RenderComponent[];

                for (const lodEntityRender of lodEntityRenders) {
                    const mis = lodEntityRender.meshInstances;
                    for (const mi of mis) {
                        const nmi = new pc.MeshInstance(mi.mesh, mi.material, mi.node);
                        nmi.castShadow = true;
                        nmi.receiveShadow = true;
                        meshInstances.push(nmi);
                    }
                }
            }

            this._meshInstancer.addLOD(meshInstances, lodEntity, lodLevel.distance, lodLevel.hysteresis);
        }

        // Reverse meshes for lods
        const lods = this._meshInstancer.LODs.filter(x => !!x.render?.meshes).sort((a, b) => b.distance - a.distance).reverse();

        this.entity.addComponent("render", {
            castShadows: true,
            meshInstances: lods.map(x => x.render!.meshes).flat()
        });

        /*
        let index = 0;
        for (const child of children) {
            this._meshInstancer.setMatrixAt(index, child.getWorldTransform());
            index++;
        }
        //*/
        //*
        for (let index = 0; index < capacity; index++) {
            this._meshInstancer.setMatrixAt(index, generateRandomTransform());
        }
        //*/
        if (numLevels > 0) {
            //this._meshInstancer.computeBVH();
            this.app.scene.on(pc.EVENT_PRECULL, (cullCameraComponent: pc.CameraComponent) => {
                if (this.autoRender) {
                    if (this.cameraEntity.camera === cullCameraComponent) {
                        const position = this.cameraEntity.getPosition();
                        const forward = this.cameraEntity.forward;
                        this._meshInstancer?.update(this._dt, cullCameraComponent.camera, position, forward);
                    }
                }
            });
        }

        this.on("attr:LODLevel", () => {
            if (this._meshInstancer) {
                let level = 0;
                const oldNumLevels = this._meshInstancer.LODs.length;
                const newNumLevels = this.LODLevel.length;
                for (level = 0; level < newNumLevels; level++) {
                    const lod = this.LODLevel[level];
                    this._meshInstancer.updateLOD(level, lod.distance, lod.hysteresis);
                }
                for (; level < oldNumLevels; level++) {
                    this._meshInstancer.remoteLOD(level);
                }
            }
        });
    }

    public update(dt: number) {
        this._dt = dt;
    }
}

export const instancedMeshScriptName = "OptiPixel:InstancedMeshScript";

pc.registerScript(InstancedMeshScript, instancedMeshScriptName);

InstancedMeshScript.attributes.add("autoRender", { type: "boolean", default: true, });
InstancedMeshScript.attributes.add("cameraEntity", { type: "entity" });
InstancedMeshScript.attributes.add("LODEntity", { type: "entity", array: true });
InstancedMeshScript.attributes.add("LODLevel", { type: "json", array: true, schema: LODLevelSchema });