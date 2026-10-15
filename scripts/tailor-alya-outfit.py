"""Refit the existing garment meshes without editing any Human.* facial mesh.
Run: blender -b --python scripts/tailor-alya-outfit.py -- --source input.glb --output output.glb
"""
import argparse
import math
import sys
import bpy
import bmesh
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=args.source)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

def smoothstep(a, b, x):
    t = max(0, min(1, (x-a)/(b-a)))
    return t*t*(3-2*t)

def material(name, color, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = 0
    return m

wool = material('Alya_Wool', (.075, .12, .13), .8)
lapel = material('Alya_Lapel', (.068, .108, .117), .78)
silk = material('Alya_Silk', (.57, .51, .42), .66)
thread = material('Alya_Thread', (.055, .087, .09), .88)
button = material('Alya_Button', (.025, .037, .038), .53)
# Small deterministic woven PBR data maps; no photographic or external assets.
size = 128
normal = bpy.data.images.new('Alya woven wool normal', width=size, height=size)
roughness = bpy.data.images.new('Alya woven wool roughness', width=size, height=size)
normal.colorspace_settings.name = 'Non-Color'
roughness.colorspace_settings.name = 'Non-Color'
normals, roughs = [], []
for y in range(size):
    for x in range(size):
        u, v = x*math.tau/8, y*math.tau/8
        over = 1 if ((x//8-y//8) % 4) < 2 else -1
        nx = .09*math.sin(u)*(1 if over>0 else .45)
        ny = .09*math.sin(v)*(.45 if over>0 else 1)
        normals.extend((.5+nx*.5, .5+ny*.5, .5+.5*math.sqrt(1-nx*nx-ny*ny), 1))
        r = .82 + .035*math.cos(u)*math.cos(v)
        roughs.extend((r,r,r,1))
normal.pixels.foreach_set(normals)
roughness.pixels.foreach_set(roughs)
normal.pack(); roughness.pack()
for m in [wool, lapel]:
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexImage');tex.image=normal
    nm = nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.55
    links.new(tex.outputs['Color'], nm.inputs['Color']);links.new(nm.outputs['Normal'],p.inputs['Normal'])
    tex = nodes.new('ShaderNodeTexImage');tex.image=roughness
    links.new(tex.outputs['Color'],p.inputs['Roughness'])

# Preserve the full head/neck and its skinning and morph controls byte-for-byte
# where the glTF exporter permits; all edits below target garment objects only.
garments = [o for o in bpy.data.objects if o.type=='MESH' and not o.name.startswith('Human')]
for o in list(garments):
    if 'Lapel_Stitch' in o.name:
        garments.remove(o);bpy.data.objects.remove(o,do_unlink=True)

seams=[]
for o in garments:
    bpy.context.view_layer.objects.active=o
    for modifier in list(o.modifiers):
        if modifier.type=='ARMATURE':o.modifiers.remove(modifier)
    # Work with the actual existing surface topology rather than constructing
    # a jacket from primitive shapes. Refine its tailored shoulder and waist.
    is_lapel='Notched_Lapel' in o.name
    is_sleeve='Sleeve' in o.name
    is_blouse='Blouse' in o.name
    if is_lapel:
        sub=o.modifiers.new('Lapel surface topology','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=4
        bpy.ops.object.modifier_apply(modifier=sub.name)
    for vertex in o.data.vertices:
        x,y,z=vertex.co
        ax=abs(x)
        x=math.copysign(.1+(ax-.1)*.76,x) if ax>.1 else x
        shoulder=smoothstep(.13,.24,abs(x))*math.exp(-((z-1.43)/.10)**2)
        z-=.016*shoulder
        if not is_blouse:
            x*=1-.035*math.exp(-((z-1.12)/.13)**2)
        if y<-.025:
            # A shaped chest, subtle dart tension and compression at armholes.
            if 'Blazer_Body' in o.name:
                y-=.006*math.exp(-((abs(x)-.105)/.075)**2-((z-1.32)/.10)**2)
                y+=.0016*math.sin((z-1.14)*78+abs(x)*18)*math.exp(-((abs(x)-.16)/.04)**2-((z-1.34)/.10)**2)
            if is_sleeve:
                y+=.0022*math.sin((z-1.25)*63+abs(x)*8)*math.exp(-((z-1.23)/.17)**2)
            if is_lapel:
                # Real roll-line curvature, with the outer edge lifted off the chest.
                y-=.009*math.exp(-((abs(x)-.095)/.043)**2-((z-1.35)/.15)**2)
                y-=.002
            if is_blouse:
                z-=.012*math.exp(-(x/.10)**2)*smoothstep(1.41,1.46,z)
                y+=.0014*math.cos(x*130)*math.exp(-((z-1.35)/.16)**2)
        vertex.co=(x,y,z)
    if is_lapel:
        # Trace the authored notched outline before solidifying, for fine edge stitching.
        bm=bmesh.new();bm.from_mesh(o.data)
        boundaries=[e for e in bm.edges if e.is_boundary]
        adjacency={}
        for e in boundaries:
            for v in e.verts:adjacency.setdefault(v,[]).append(e.other_vert(v))
        start=next(iter(adjacency));prev=None;cur=start;points=[]
        for _ in range(len(boundaries)+1):
            points.append(cur.co.copy()+Vector((0,-.002,0)))
            nxt=next((v for v in adjacency[cur] if v!=prev),start)
            prev,cur=cur,nxt
            if cur==start:break
        bm.free()
        curve=bpy.data.curves.new(o.name+' edge tailoring','CURVE');curve.dimensions='3D';curve.bevel_depth=.00035;curve.bevel_resolution=2
        spl=curve.splines.new('POLY');spl.points.add(len(points)-1)
        for p,co in zip(spl.points,points):p.co=(*co,1)
        spl.use_cyclic_u=True
        seam=bpy.data.objects.new(o.name+'_Edge',curve);bpy.context.collection.objects.link(seam);seam.data.materials.append(thread);seams.append(seam)
    # Thin fabric has actual sides and softened edges, not double-sided planes.
    if is_lapel or is_blouse or 'Pocket' in o.name:
        solid=o.modifiers.new('Fabric thickness','SOLIDIFY');solid.thickness=.0024 if is_lapel else .0012;solid.offset=0
        bpy.ops.object.modifier_apply(modifier=solid.name)
        bevel=o.modifiers.new('Soft tailored edge','BEVEL');bevel.width=.0008;bevel.segments=3
        bpy.ops.object.modifier_apply(modifier=bevel.name)
    target=silk if is_blouse else lapel if is_lapel or 'Pocket' in o.name else button if 'Button' in o.name else wool
    o.data.materials.clear();o.data.materials.append(target)
    for face in o.data.polygons:face.use_smooth=True

for o in seams:
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target='MESH');garments.append(bpy.context.object)

for o in garments:
    # Per-face textile projection keeps thread scale in real-world units.
    uv=o.data.uv_layers.active or o.data.uv_layers.new(name='TailoringUV')
    for face in o.data.polygons:
        for index in face.loop_indices:
            v=o.data.vertices[o.data.loops[index].vertex_index].co
            uv.data[index].uv=((v.x if abs(face.normal.y)>=abs(face.normal.x) else v.y)*60,v.z*60)
    o.vertex_groups.clear()
    groups={n:o.vertex_groups.new(name=n) for n in ['Spine','Spine1','Spine2','LeftShoulder','RightShoulder','LeftArm','RightArm']}
    for v in o.data.vertices:
        x,y,z=v.co
        top=smoothstep(1.16,1.40,z)
        bottom=(1-top)*(1-smoothstep(.95,1.18,z))
        weights={'Spine':bottom,'Spine1':1-top-bottom,'Spine2':top}
        if 'Sleeve' in o.name:
            side='Left' if x>0 else 'Right'
            arm=.65*(1-smoothstep(1.32,1.44,z))
            shoulder=.25*smoothstep(1.30,1.43,z)
            weights={k:w*(1-arm-shoulder) for k,w in weights.items()}
            weights[side+'Arm']=arm;weights[side+'Shoulder']=shoulder
        for name,w in weights.items():
            if w>0:groups[name].add([v.index],w,'REPLACE')
    o.parent=rig
    mod=o.modifiers.new('Tailored garment skinning','ARMATURE');mod.object=rig
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=args.output,export_format='GLB',use_selection=True,export_morph=True,export_skins=True,export_animations=False)
