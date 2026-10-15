"""Offline geometry QA only; studio lighting does not replicate WebGL shading.
Run: blender -b --python scripts/render-alya-fit-qa.py -- --source model.glb --output-dir artifacts/alya-fit
"""
import argparse, sys
from pathlib import Path
import bpy, math
parser=argparse.ArgumentParser()
parser.add_argument('--source',required=True)
parser.add_argument('--output-dir',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
out=Path(args.output_dir).resolve();out.mkdir(parents=True,exist_ok=True)
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(Path(args.source).resolve()))
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
bpy.context.view_layer.update()
head=rig.matrix_world @ rig.pose.bones['Head'].head
print('HEAD',head)
world=bpy.context.scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.18,.23,1);world.node_tree.nodes['Background'].inputs[1].default_value=.45
focus=head+Vector((0,0,.035))
for loc,power,color,size in [((-2.5,-2.6,3.2),220,(1,.88,.8),3),((2,-2,1.9),75,(.7,.85,1),2),((1.2,1.6,2.2),180,(.55,1,.88),2)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.color=color;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(focus-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=focus+Vector((.035,-1.5,.025)));cam=bpy.context.object;cam.rotation_euler=(focus-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=72
scene=bpy.context.scene;scene.camera=cam;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=600;scene.render.resolution_y=800;scene.render.resolution_percentage=100;scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(out/'offline-neutral.png');bpy.ops.render.render(write_still=True)

for o in bpy.data.objects:
 if o.type=='MESH' and o.data.shape_keys:
  for k in o.data.shape_keys.key_blocks:
   if k.name in ['eyeBlinkLeft','eyeBlinkRight']:k.value=1
   if k.name=='viseme_aa':k.value=.5
scene.render.filepath=str(out/'offline-blink-speech.png');bpy.ops.render.render(write_still=True)
for o in bpy.data.objects:
 if o.type=='MESH' and o.data.shape_keys:
  for k in o.data.shape_keys.key_blocks:k.value=0
head_bone=rig.pose.bones['Head'];head_bone.rotation_mode='XYZ';head_bone.rotation_euler.y=.18
cam.location=focus+Vector((.45,-1.4,.025));cam.rotation_euler=(focus-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(out/'offline-turned.png');bpy.ops.render.render(write_still=True)

# Match the actual application camera and aspect ratios; offline lighting only.
cam.data.sensor_fit='VERTICAL';cam.data.sensor_height=36;cam.data.lens=36/(2*math.tan(math.radians(14)))
head_bone.rotation_euler=(0,0,0)
for label,w,h,position,target in [('desktop',500,790,(.065,-1.55,1.6),(0,0,1.57)),('mobile',390,240,(.065,-1.1,1.66),(0,0,1.65))]:
 scene.render.resolution_x=w;scene.render.resolution_y=h;cam.location=position;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=str(out/('offline-'+label+'.png'));bpy.ops.render.render(write_still=True)

scene.render.resolution_x=500;scene.render.resolution_y=790
cam.location=(.065,-1.55,1.6);cam.rotation_euler=(Vector((0,0,1.57))-cam.location).to_track_quat('-Z','Y').to_euler()
for name in ['Spine2','LeftShoulder','RightShoulder']:
 bone=rig.pose.bones[name];bone.rotation_mode='XYZ';bone.rotation_euler.x=.018;bone.rotation_euler.z=.012
head_bone.rotation_euler.y=-.1
scene.render.filepath=str(out/'offline-motion.png');bpy.ops.render.render(write_still=True)
