import bpy, gzip, argparse, sys, tempfile
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument("--source", required=True, help="CC0 TalkingHead MPFB GLB")
parser.add_argument("--output", required=True)
args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(Path(args.source).resolve()))
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
# Keep the integrated face and neck, real eyelids, brows, teeth and hair.
# The retained tailored blazer supplies the upper body below the neckline.
for o in list(bpy.data.objects):
 if o.type!='MESH':continue
 if 'female_casualsuit' in o.name:
  bpy.data.objects.remove(o,do_unlink=True);continue
 if o.data.shape_keys:
  for key in o.data.shape_keys.key_blocks:key.value=0
 if o.name=='Human' or o.data.name=='base' or any(m and m.name=='Human.body' for m in o.data.materials):
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT');bpy.ops.object.mode_set(mode='OBJECT')
  for v in o.data.vertices:v.select=(o.matrix_world @ v.co).z<1.32 or (abs((o.matrix_world @ v.co).x)>.24 and (o.matrix_world @ v.co).z<1.49)
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.delete(type='VERT');bpy.ops.object.mode_set(mode='OBJECT')
original=set(bpy.data.objects)
with gzip.open('public/avatars/alya/alya.glb.gz','rb') as f:data=f.read()
with tempfile.TemporaryDirectory() as tmp:
 original_path=Path(tmp)/'original.glb'
 original_path.write_bytes(data)
 bpy.ops.import_scene.gltf(filepath=str(original_path))
added=set(bpy.data.objects)-original
discard=[]
for o in list(added):
 if o.type=='MESH' and any(s in o.name for s in ['Blazer','Jacket','Lapel','Blouse','Pocket']):
  bpy.context.view_layer.objects.active=o
  for mod in list(o.modifiers):
   if mod.type=='ARMATURE':bpy.ops.object.modifier_apply(modifier=mod.name)
  world=o.matrix_world.copy();o.parent=None;o.matrix_world=world
  # Fit existing tailored shoulders to the replacement human's proportions.
  for v in o.data.vertices:
   v.co.x*=.84
   v.co.z+=.065
   v.co.y-=.015
  o.vertex_groups.clear();g=o.vertex_groups.new(name='Spine2');g.add(list(range(len(o.data.vertices))),1,'REPLACE')
  mod=o.modifiers.new('Alya torso rig','ARMATURE');mod.object=rig;o.parent=rig
 else:
  discard.append(o)
for o in discard:bpy.data.objects.remove(o,do_unlink=True)
# The source blink leaves a thin sclera gap. Extend the authored eyelid/lash
# displacement together, without moving the eyes or changing their alignment.
for o in bpy.data.objects:
 if o.type=='MESH' and o.data.shape_keys:
  basis=o.data.shape_keys.key_blocks[0]
  for key in o.data.shape_keys.key_blocks:
   if key.name in ['eyeBlinkLeft','eyeBlinkRight']:
    for base,vertex in zip(basis.data,key.data):vertex.co=base.co+(vertex.co-base.co)*1.1
for m in bpy.data.materials:
 if not m.use_nodes:continue
 p=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if not p:continue
 if m.name=='Human.body':p.inputs['Roughness'].default_value=.64
 if 'Navy' in m.name:
  p.inputs['Base Color'].default_value=(.012,.036,.043,1);p.inputs['Roughness'].default_value=.8;p.inputs['Metallic'].default_value=0
 if m.name=='Ivory_Knit':p.inputs['Base Color'].default_value=(.026,.038,.043,1)
 if 'Hair' in m.name or 'ponytail' in m.name:p.inputs['Roughness'].default_value=.7
 if 'high-poly' in m.name:p.inputs['Roughness'].default_value=.24
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(Path(args.output).resolve()),export_format='GLB',use_selection=True,export_morph=True,export_skins=True,export_animations=False)
