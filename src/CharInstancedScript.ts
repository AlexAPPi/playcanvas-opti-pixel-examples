export class CharInstancedScript extends pc.ScriptType {

    private _createInstacingBuffer(opacity: number) {
        
    }

    public update(dt: number) {

    }
}

export const charInstancedScriptName = "OptiPixel:CharInstancedScript";

pc.registerScript(CharInstancedScript, charInstancedScriptName);

CharInstancedScript.attributes.add("autoRender", { type: "boolean", default: true, });