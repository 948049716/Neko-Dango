#!/usr/bin/env python3
"""生成《猫咪团子》Cocos Creator 3.8 预制工程（client/）。

产出：工程 package.json / tsconfig / settings（设计分辨率 750×1334）/ .gitignore、
assets 下全部目录与文件的 .meta、assets/scenes/Game.scene（手工编排的场景图）。

格式依据：真实 3.8.0 工程的 package.json、scene/meta/settings 文件实测样本；
脚本组件的 __type__ 为其 .meta uuid 的压缩形式（算法已用真实样本验证，见下方自检）。
脚本可重复运行：已有 .meta 的 uuid 会被复用，不会破坏既有绑定。
"""
import json
import random
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "client"
ASSETS = CLIENT / "assets"

B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def compress_uuid(u: str) -> str:
    hexs = u.replace("-", "")
    out = [hexs[:5]]
    rest = hexs[5:]
    for i in range(0, len(rest) - 2, 3):
        v = int(rest[i : i + 3], 16)
        out.append(B64[v >> 6])
        out.append(B64[v & 63])
    return "".join(out)


# 自检：真实 3.8.0 工程样本中 game-manager.ts 的 meta uuid 与场景内的组件 __type__
assert compress_uuid("a7113a35-ec98-4c55-b079-6f51da5a20f7") == "a7113o17JhMVbB5b1HaWiD3"


def new_id22() -> str:
    return "".join(random.choice(B64) for _ in range(22))


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def ensure_meta(asset_path: Path, importer: str, ver: str, files: list) -> str:
    meta_path = Path(str(asset_path) + ".meta")
    uid = None
    if meta_path.exists():
        uid = read_json(meta_path)["uuid"]
    if not uid:
        uid = str(uuid.uuid4())
    write_json(
        meta_path,
        {
            "ver": ver,
            "importer": importer,
            "imported": True,
            "uuid": uid,
            "files": files,
            "subMetas": {},
            "userData": {},
        },
    )
    return uid


def main() -> None:
    uuids: dict[str, str] = {}

    # ---------- .meta ----------
    for d in [
        "configs",
        "scripts",
        "scripts/domain",
        "scripts/application",
        "scripts/bootstrap",
        "scripts/presentation",
        "scenes",
    ]:
        uuids[f"dir:{d}"] = ensure_meta(ASSETS / d, "directory", "1.2.0", [])
    uuids["config"] = ensure_meta(
        ASSETS / "configs/game-config.json", "json", "2.0.1", [".json"]
    )
    ts_files = [
        "scripts/domain/Rng.ts",
        "scripts/domain/GameConfig.ts",
        "scripts/domain/Types.ts",
        "scripts/domain/ScoreRules.ts",
        "scripts/domain/SpawnPolicy.ts",
        "scripts/domain/DangerRules.ts",
        "scripts/domain/MergeRules.ts",
        "scripts/application/GameSession.ts",
        "scripts/bootstrap/GameBootstrap.ts",
        "scripts/presentation/BulletPhysicsAdapter.ts",
        "scripts/presentation/HudView.ts",
        "scripts/presentation/InputView.ts",
    ]
    for f in ts_files:
        uuids[f"ts:{f}"] = ensure_meta(ASSETS / f, "typescript", "4.0.23", [])
    scene_uuid = ensure_meta(ASSETS / "scenes/Game.scene", "scene", "1.1.45", [".json"])
    uuids["scene"] = scene_uuid

    # ---------- 工程根文件 ----------
    pkg_path = CLIENT / "package.json"
    project_uuid = None
    if pkg_path.exists():
        project_uuid = read_json(pkg_path).get("uuid")
    if not project_uuid:
        project_uuid = str(uuid.uuid4())
    write_json(
        pkg_path,
        {"name": "neko-dango", "uuid": project_uuid, "creator": {"version": "3.8.0"}},
    )
    write_json(
        CLIENT / "tsconfig.json",
        {
            "extends": "./temp/tsconfig.cocos.json",
            "compilerOptions": {"strict": True},
        },
    )
    write_json(
        CLIENT / "settings/v2/packages/project.json",
        {
            "__version__": "1.0.5",
            "general": {
                "designResolution": {
                    "width": 750,
                    "height": 1334,
                    "fitWidth": True,
                    "fitHeight": False,
                }
            },
            "custom_joint_texture_layouts": [],
        },
    )
    (CLIENT / ".gitignore").write_text(
        "library/\ntemp/\nlocal/\nbuild/\nprofiles/\nnative\nnode_modules/\n.vscode/\n.idea/\n",
        encoding="utf-8",
    )

    # ---------- 场景 ----------
    scene = build_scene(uuids)
    write_json(ASSETS / "scenes/Game.scene", scene)
    validate_scene(scene, uuids)
    print(f"工程骨架已生成：场景对象 {len(scene)} 个，Game.scene uuid {scene_uuid}")
    for key in ["ts:scripts/bootstrap/GameBootstrap.ts", "config", "scene"]:
        print(f"  {key}: {uuids[key]}")


# ================= 场景构建 =================

objs: list[dict] = []


def add(obj: dict) -> int:
    objs.append(obj)
    return len(objs) - 1


def ref(i: int) -> dict:
    return {"__id__": i}


def vec3(x, y, z) -> dict:
    return {"__type__": "cc.Vec3", "x": x, "y": y, "z": z}


def vec2(x, y) -> dict:
    return {"__type__": "cc.Vec2", "x": x, "y": y}


def quat(x, y, z, w) -> dict:
    return {"__type__": "cc.Quat", "x": x, "y": y, "z": z, "w": w}


def color(r, g, b, a=255) -> dict:
    return {"__type__": "cc.Color", "r": r, "g": g, "b": b, "a": a}


def comp_base(type_: str, node_id: int) -> dict:
    return {
        "__type__": type_,
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": ref(node_id),
        "_enabled": True,
        "__prefab__": None,
    }


def add_comp(node_id: int, comp: dict) -> int:
    comp["_id"] = new_id22()
    idx = add(comp)
    objs[node_id]["_components"].append(ref(idx))
    return idx


def make_node(name, parent_id, layer, pos=(0, 0, 0), active=True, euler=(0, 0, 0), rot=None):
    node = {
        "__type__": "cc.Node",
        "_name": name,
        "_objFlags": 0,
        "__editorExtras__": {},
        "_parent": ref(parent_id) if parent_id is not None else None,
        "_children": [],
        "_active": active,
        "_components": [],
        "_prefab": None,
        "_lpos": vec3(*pos),
        "_lrot": rot if rot is not None else quat(0, 0, 0, 1),
        "_lscale": vec3(1, 1, 1),
        "_mobility": 0,
        "_layer": layer,
        "_euler": vec3(*euler),
        "_id": new_id22(),
    }
    idx = add(node)
    if parent_id is not None:
        objs[parent_id]["_children"].append(ref(idx))
    return idx


def ui_transform(node_id, w, h):
    c = comp_base("cc.UITransform", node_id)
    c["_contentSize"] = {"__type__": "cc.Size", "width": w, "height": h}
    c["_anchorPoint"] = vec2(0.5, 0.5)
    return add_comp(node_id, c)


def widget(node_id, flags, left=0, right=0, top=0, bottom=0):
    c = comp_base("cc.Widget", node_id)
    c.update(
        {
            "_alignFlags": flags,
            "_target": None,
            "_left": left,
            "_right": right,
            "_top": top,
            "_bottom": bottom,
            "_horizontalCenter": 0,
            "_verticalCenter": 0,
            "_isAbsLeft": True,
            "_isAbsRight": True,
            "_isAbsTop": True,
            "_isAbsBottom": True,
            "_isAbsHorizontalCenter": True,
            "_isAbsVerticalCenter": True,
            "_originalWidth": 0,
            "_originalHeight": 0,
            "_alignMode": 2,
            "_lockFlags": 0,
        }
    )
    return add_comp(node_id, c)


def label_comp(node_id, text, font_size, col, bold=False):
    c = comp_base("cc.Label", node_id)
    c.update(
        {
            "_customMaterial": None,
            "_srcBlendFactor": 2,
            "_dstBlendFactor": 4,
            "_color": col,
            "_string": text,
            "_horizontalAlign": 1,
            "_verticalAlign": 1,
            "_actualFontSize": font_size,
            "_fontSize": font_size,
            "_fontFamily": "Arial",
            "_lineHeight": font_size,
            "_overflow": 0,
            "_enableWrapText": True,
            "_font": None,
            "_isSystemFontUsed": True,
            "_spacingX": 0,
            "_isItalic": False,
            "_isBold": bold,
            "_isUnderline": False,
            "_underlineHeight": 2,
            "_cacheMode": 0,
        }
    )
    return add_comp(node_id, c)


DEFAULT_SPRITE_FRAME = "f3d876b2-246f-4a8b-8a3a-712e075434c7@f9941"


def sprite_comp(node_id, col):
    c = comp_base("cc.Sprite", node_id)
    c.update(
        {
            "_customMaterial": None,
            "_srcBlendFactor": 2,
            "_dstBlendFactor": 4,
            "_color": col,
            "_spriteFrame": {"__uuid__": DEFAULT_SPRITE_FRAME, "__expectedType__": "cc.SpriteFrame"},
            "_type": 0,
            "_fillType": 0,
            "_sizeMode": 0,
            "_fillCenter": vec2(0, 0),
            "_fillStart": 0,
            "_fillRange": 0,
            "_isTrimmedMode": True,
            "_useGrayscale": False,
            "_atlas": None,
        }
    )
    return add_comp(node_id, c)


def button_comp(node_id):
    c = comp_base("cc.Button", node_id)
    c.update(
        {
            "clickEvents": [],
            "_interactable": True,
            "_transition": 2,
            "_normalColor": color(214, 214, 214),
            "_hoverColor": color(211, 211, 211),
            "_pressedColor": color(255, 255, 255),
            "_disabledColor": color(124, 124, 124),
            "_normalSprite": None,
            "_hoverSprite": None,
            "_pressedSprite": None,
            "_disabledSprite": None,
            "_duration": 0.1,
            "_zoomScale": 1.05,
            "_target": None,
        }
    )
    return add_comp(node_id, c)


def label_node(parent_id, name, text, font_size, col, pos, w, h, bold=False):
    n = make_node(name, parent_id, 33554432, pos)
    ui_transform(n, w, h)
    lc = label_comp(n, text, font_size, col, bold)
    return n, lc


def build_scene(uuids: dict) -> list:
    global objs
    objs = []
    scene_uuid = uuids["scene"]
    ink = color(90, 64, 56)
    coral_dark = color(214, 69, 65)
    cream = color(255, 249, 239)

    # [0] SceneAsset / [1] Scene（children 与 globals/prefab 末尾回填）
    add(
        {
            "__type__": "cc.SceneAsset",
            "_name": "Game",
            "_objFlags": 0,
            "__editorExtras__": {},
            "_native": "",
            "scene": ref(1),
        }
    )
    scene_obj = {
        "__type__": "cc.Scene",
        "_name": "Game",
        "_objFlags": 0,
        "__editorExtras__": {},
        "_parent": None,
        "_children": [],
        "_active": True,
        "_components": [],
        "_prefab": None,
        "_lpos": vec3(0, 0, 0),
        "_lrot": quat(0, 0, 0, 1),
        "_lscale": vec3(1, 1, 1),
        "_mobility": 0,
        "_layer": 1073741824,
        "_euler": vec3(0, 0, 0),
        "autoReleaseAssets": False,
        "_globals": None,
        "_id": scene_uuid,
    }
    scene_idx = add(scene_obj)

    # 主光源（参数照真实 3.8.0 默认场景）
    light_node = make_node(
        "Main Light",
        scene_idx,
        1073741824,
        (0, 0, 0),
        euler=(-117.894, 165.091, 38.562),
        rot=quat(-0.06397656665577071, -0.44608233363525845, -0.8239028751062036, -0.3436591377065261),
    )
    static_settings = add({"__type__": "cc.StaticLightSettings", "_baked": False, "_editorOnly": False, "_castShadow": False})
    light_comp = comp_base("cc.DirectionalLight", light_node)
    light_comp.update(
        {
            "_color": color(255, 250, 240),
            "_useColorTemperature": False,
            "_colorTemperature": 6550,
            "_staticSettings": ref(static_settings),
            "_visibility": -325058561,
            "_illuminanceHDR": 65000,
            "_illuminance": 65000,
            "_illuminanceLDR": 1.6927083333333335,
            "_shadowEnabled": False,
            "_shadowPcf": 0,
            "_shadowBias": 0.00001,
            "_shadowNormalBias": 0,
            "_shadowSaturation": 1,
            "_shadowDistance": 50,
            "_shadowInvisibleOcclusionRange": 200,
            "_csmLevel": 4,
            "_csmLayerLambda": 0.75,
            "_csmOptimizationMode": 2,
            "_csmAdvancedOptions": False,
            "_csmLayersTransition": False,
            "_csmTransitionRange": 0.05,
            "_shadowFixedArea": False,
            "_shadowNear": 0.1,
            "_shadowFar": 10,
            "_shadowOrthoSize": 5,
        }
    )
    add_comp(light_node, light_comp)

    # 主相机：透视 FOV 30（art/scene-spec.json），位于玩法平面正前方
    cam_node = make_node("Main Camera", scene_idx, 1073741824, (0, 3.6, 14))
    cam_comp = comp_base("cc.Camera", cam_node)
    cam_comp.update(
        {
            "_projection": 1,
            "_priority": 0,
            "_fov": 30,
            "_fovAxis": 0,
            "_orthoHeight": 10,
            "_near": 1,
            "_far": 100,
            "_color": color(51, 51, 51),
            "_depth": 1,
            "_stencil": 0,
            "_clearFlags": 14,
            "_rect": {"__type__": "cc.Rect", "x": 0, "y": 0, "width": 1, "height": 1},
            "_aperture": 19,
            "_shutter": 7,
            "_iso": 0,
            "_screenScale": 1,
            "_visibility": 1822425087,
            "_targetTexture": None,
            "_postProcess": None,
            "_usePostProcess": False,
            "_cameraType": -1,
            "_trackingType": 0,
        }
    )
    add_comp(cam_node, cam_comp)

    # Canvas（设计分辨率 750×1334，局部坐标原点在画布中心）
    canvas_node = make_node("Canvas", scene_idx, 33554432, (375, 667, 0))
    ui_cam_node = make_node("Camera", canvas_node, 1073741824, (0, 0, 1000))
    ui_cam_comp = comp_base("cc.Camera", ui_cam_node)
    ui_cam_comp.update(
        {
            "_projection": 0,
            "_priority": 1073741824,
            "_fov": 45,
            "_fovAxis": 0,
            "_orthoHeight": 667,
            "_near": 1,
            "_far": 2000,
            "_color": color(0, 0, 0),
            "_depth": 1,
            "_stencil": 0,
            "_clearFlags": 6,
            "_rect": {"__type__": "cc.Rect", "x": 0, "y": 0, "width": 1, "height": 1},
            "_aperture": 19,
            "_shutter": 7,
            "_iso": 0,
            "_screenScale": 1,
            "_visibility": 41943040,
            "_targetTexture": None,
            "_postProcess": None,
            "_usePostProcess": False,
            "_cameraType": -1,
            "_trackingType": 0,
        }
    )
    ui_cam_comp_idx = add_comp(ui_cam_node, ui_cam_comp)
    ui_transform(canvas_node, 750, 1334)
    canvas_comp = comp_base("cc.Canvas", canvas_node)
    canvas_comp["_cameraComponent"] = ref(ui_cam_comp_idx)
    canvas_comp["_alignCanvasWithScreen"] = True
    add_comp(canvas_node, canvas_comp)
    widget(canvas_node, 45)
    input_comp = comp_base(compress_uuid(uuids["ts:scripts/presentation/InputView.ts"]), canvas_node)
    input_comp_idx = add_comp(canvas_node, input_comp)

    # HUD 根
    hud_root = make_node("HudRoot", canvas_node, 33554432, (0, 0, 0))
    ui_transform(hud_root, 750, 1334)
    _, score_label = label_node(hud_root, "ScoreLabel", "分数 0", 40, ink, (0, 601, 0), 360, 70, bold=True)
    _, combo_label = label_node(hud_root, "ComboLabel", "", 28, coral_dark, (0, 545, 0), 300, 44, bold=True)
    next_bubble = make_node("NextBubble", hud_root, 33554432, (284, 592, 0))
    ui_transform(next_bubble, 126, 106)
    sprite_comp(next_bubble, cream)
    label_node(next_bubble, "NextTitle", "Next", 20, color(111, 169, 163), (0, 30, 0), 100, 28, bold=True)
    _, next_label = label_node(next_bubble, "NextValue", "Lv1", 26, ink, (0, -20, 0), 110, 40, bold=True)
    _, danger_label = label_node(hud_root, "DangerLabel", "", 92, color(229, 72, 77), (0, 300, 0), 200, 110, bold=True)

    prop_bar = make_node("PropBar", hud_root, 33554432, (0, -585, 0))
    ui_transform(prop_bar, 664, 112)
    prop_texts = ["逗猫棒 ×2", "香酥鱼干 ×1", "彩虹球 ×0", "吹风机 ×1"]
    for i, text in enumerate(prop_texts):
        p = make_node(f"Prop{i + 1}", prop_bar, 33554432, (-249 + i * 166, 0, 0))
        ui_transform(p, 158, 112)
        sprite_comp(p, cream)
        label_comp(p, text, 22, ink)

    # 结算 Overlay（默认隐藏）
    overlay = make_node("Overlay", hud_root, 33554432, (0, 0, 0), active=False)
    ui_transform(overlay, 750, 1334)
    sprite_comp(overlay, color(64, 42, 32, 115))
    panel = make_node("Panel", overlay, 33554432, (0, 40, 0))
    ui_transform(panel, 440, 520)
    sprite_comp(panel, cream)
    _, result_title = label_node(panel, "ResultTitle", "猫窝溢出啦！", 40, ink, (0, 200, 0), 400, 56, bold=True)
    _, result_score = label_node(panel, "ResultScore", "0 分", 54, ink, (0, 128, 0), 400, 70, bold=True)
    _, result_detail = label_node(panel, "ResultDetail", "", 26, color(140, 115, 100), (0, 62, 0), 400, 40)

    def make_button(parent, name, text, text_col, bg_col, pos, bold):
        b = make_node(name, parent, 33554432, pos)
        ui_transform(b, 320, 78)
        sprite_comp(b, bg_col)
        btn = button_comp(b)
        label_node(b, "Label", text, 30, text_col, (0, 0, 0), 320, 78, bold=bold)
        return btn

    revive_btn = make_button(panel, "ReviveButton", "复活一次", color(255, 255, 255), color(233, 133, 125), (0, -30, 0), True)
    settle_btn = make_button(panel, "SettleButton", "就这样吧", coral_dark, color(255, 255, 255), (0, -122, 0), False)
    restart_btn = make_button(panel, "RestartButton", "再来一局", coral_dark, color(246, 233, 212), (0, -214, 0), True)

    hud_comp = comp_base(compress_uuid(uuids["ts:scripts/presentation/HudView.ts"]), hud_root)
    hud_comp.update(
        {
            "scoreLabel": ref(score_label),
            "comboLabel": ref(combo_label),
            "nextLabel": ref(next_label),
            "dangerLabel": ref(danger_label),
            "overlay": ref(overlay),
            "resultTitle": ref(result_title),
            "resultScore": ref(result_score),
            "resultDetail": ref(result_detail),
            "reviveButton": ref(revive_btn),
            "settleButton": ref(settle_btn),
            "restartButton": ref(restart_btn),
        }
    )
    hud_comp_idx = add_comp(hud_root, hud_comp)

    # GameRoot（3D 装配）
    game_root = make_node("GameRoot", scene_idx, 1073741824, (0, 0, 0))
    world_root = make_node("WorldRoot", game_root, 1073741824, (0, 0, 0))
    container_root = make_node("ContainerRoot", game_root, 1073741824, (0, 0, 0))
    boot_comp = comp_base(compress_uuid(uuids["ts:scripts/bootstrap/GameBootstrap.ts"]), game_root)
    boot_comp.update(
        {
            "configAsset": {"__uuid__": uuids["config"], "__expectedType__": "cc.JsonAsset"},
            "worldRoot": ref(world_root),
            "containerRoot": ref(container_root),
            "catPrefab": None,
            "hud": ref(hud_comp_idx),
            "input": ref(input_comp_idx),
        }
    )
    add_comp(game_root, boot_comp)

    # 场景全局（照真实 3.8.0 默认值，含引擎内置环境贴图 uuid）
    ambient = add(
        {
            "__type__": "cc.AmbientInfo",
            "_skyColorHDR": {"__type__": "cc.Vec4", "x": 0.2, "y": 0.5, "z": 0.8, "w": 0.520833125},
            "_skyColor": {"__type__": "cc.Vec4", "x": 0.2, "y": 0.5, "z": 0.8, "w": 0.520833125},
            "_skyIllumHDR": 20000,
            "_skyIllum": 20000,
            "_groundAlbedoHDR": {"__type__": "cc.Vec4", "x": 0.2, "y": 0.2, "z": 0.2, "w": 1},
            "_groundAlbedo": {"__type__": "cc.Vec4", "x": 0.2, "y": 0.2, "z": 0.2, "w": 1},
            "_skyColorLDR": {"__type__": "cc.Vec4", "x": 0.452588, "y": 0.607642, "z": 0.755699, "w": 0},
            "_skyIllumLDR": 0.8,
            "_groundAlbedoLDR": {"__type__": "cc.Vec4", "x": 0.618555, "y": 0.577848, "z": 0.544564, "w": 0},
        }
    )
    shadows = add(
        {
            "__type__": "cc.ShadowsInfo",
            "_enabled": False,
            "_type": 0,
            "_normal": vec3(0, 1, 0),
            "_distance": 0,
            "_shadowColor": color(76, 76, 76),
            "_maxReceived": 4,
            "_size": vec2(1024, 1024),
        }
    )
    skybox = add(
        {
            "__type__": "cc.SkyboxInfo",
            "_envLightingType": 0,
            "_envmapHDR": {"__uuid__": "d032ac98-05e1-4090-88bb-eb640dcb5fc1@b47c0", "__expectedType__": "cc.TextureCube"},
            "_envmap": {"__uuid__": "d032ac98-05e1-4090-88bb-eb640dcb5fc1@b47c0", "__expectedType__": "cc.TextureCube"},
            "_envmapLDR": {"__uuid__": "6f01cf7f-81bf-4a7e-bd5d-0afc19696480@b47c0", "__expectedType__": "cc.TextureCube"},
            "_diffuseMapHDR": None,
            "_diffuseMapLDR": None,
            "_enabled": True,
            "_useHDR": True,
            "_editableMaterial": None,
            "_reflectionHDR": None,
            "_reflectionLDR": None,
            "_rotationAngle": 0,
        }
    )
    fog = add(
        {
            "__type__": "cc.FogInfo",
            "_type": 0,
            "_fogColor": color(200, 200, 200),
            "_enabled": False,
            "_fogDensity": 0.3,
            "_fogStart": 0.5,
            "_fogEnd": 300,
            "_fogAtten": 5,
            "_fogTop": 1.5,
            "_fogRange": 1.2,
            "_accurate": False,
        }
    )
    octree = add(
        {
            "__type__": "cc.OctreeInfo",
            "_enabled": False,
            "_minPos": vec3(-1024, -1024, -1024),
            "_maxPos": vec3(1024, 1024, 1024),
            "_depth": 8,
        }
    )
    skin = add({"__type__": "cc.SkinInfo", "_enabled": True, "_blurRadius": 0.01, "_sssIntensity": 3})
    light_probe = add(
        {
            "__type__": "cc.LightProbeInfo",
            "_giScale": 1,
            "_giSamples": 1024,
            "_bounces": 2,
            "_reduceRinging": 0,
            "_showProbe": True,
            "_showWireframe": True,
            "_showConvex": False,
            "_data": None,
            "_lightProbeSphereVolume": 1,
        }
    )
    globals_idx = add(
        {
            "__type__": "cc.SceneGlobals",
            "ambient": ref(ambient),
            "shadows": ref(shadows),
            "_skybox": ref(skybox),
            "fog": ref(fog),
            "octree": ref(octree),
            "skin": ref(skin),
            "lightProbeInfo": ref(light_probe),
            "bakedWithStationaryMainLight": False,
            "bakedWithHighpLightmap": False,
        }
    )
    prefab_info = add(
        {
            "__type__": "cc.PrefabInfo",
            "root": None,
            "asset": None,
            "fileId": scene_uuid,
            "instance": None,
            "targetOverrides": None,
            "nestedPrefabInstanceRoots": [],
        }
    )
    scene_obj["_globals"] = ref(globals_idx)
    scene_obj["_prefab"] = ref(prefab_info)
    return objs


def validate_scene(scene: list, uuids: dict) -> None:
    n = len(scene)

    def walk(v):
        if isinstance(v, dict):
            if set(v.keys()) == {"__id__"}:
                assert 0 <= v["__id__"] < n, f"__id__ 越界: {v}"
            else:
                for x in v.values():
                    walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(scene)
    # 父子对称
    for i, o in enumerate(scene):
        if o.get("__type__") == "cc.Node":
            for c in o["_children"]:
                assert scene[c["__id__"]]["_parent"]["__id__"] == i, f"父子不对称: {i}"
            for c in o["_components"]:
                assert scene[c["__id__"]]["node"]["__id__"] == i, f"组件归属不对称: {i}"
    types = {o.get("__type__") for o in scene}
    for key in [
        "ts:scripts/bootstrap/GameBootstrap.ts",
        "ts:scripts/presentation/HudView.ts",
        "ts:scripts/presentation/InputView.ts",
    ]:
        assert compress_uuid(uuids[key]) in types, f"场景缺少脚本组件 {key}"
    assert scene[1]["_id"] == uuids["scene"], "场景 _id 与 meta uuid 不一致"
    boot = next(o for o in scene if o.get("__type__") == compress_uuid(uuids["ts:scripts/bootstrap/GameBootstrap.ts"]))
    assert boot["configAsset"]["__uuid__"] == uuids["config"], "configAsset 绑定不一致"
    print("场景一致性校验通过：__id__ 引用、父子/组件对称、脚本绑定、uuid 对齐均无误")


if __name__ == "__main__":
    main()
