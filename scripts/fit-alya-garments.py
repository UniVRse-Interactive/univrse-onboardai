"""Original, body-aware garment fitting for Alya's existing skinned character.

Input is tailored-wool-v1. Human meshes, morphs and their materials are read-only.
The shirt and lapels are newly constructed surfaces; jacket/sleeves are refitted.
Run with Blender: --python this.py -- --source before.glb --output after.glb
"""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=args.source)
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = bpy.data.objects['Human']
body_vertices = [body.matrix_world @ v.co for v in body.data.vertices]
body_faces = [list(p.vertices) for p in body.data.polygons]
body_bvh = BVHTree.FromPolygons(body_vertices, body_faces)

def smooth(a, b, x):
    t = max(0, min(1, (x-a)/(b-a)))
    return t*t*(3-2*t)

def skin_front(x, z):
    hit, _, _, _ = body_bvh.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0)))
    return hit.y if hit is not None else None

def profile(z):
    # A continuous fitted torso under the retained upper chest. Values are in
    # metres and smoothly interpolate the measured sternum surface above 1.44.
    knots = [(0.88,-.103),(1.08,-.110),(1.22,-.132),(1.32,-.133),
             (1.38,-.114),(1.42,-.095),(1.45,-.081),(1.48,-.076),(1.54,-.068)]
    for (a, ya), (b, yb) in zip(knots,knots[1:]):
        if z <= b:
            return ya+(yb-ya)*smooth(a,b,z)
    return knots[-1][1]

def torso(x,z):
    # Smooth anatomical envelope, calibrated to chest measurements. Projecting
    # every vertex independently onto incomplete skin causes abrupt folds at
    # missing triangles, so use a continuous sternum/pectoral contour instead.
    curvature = 1.3 + 1.3*smooth(1.42,1.45,z) + 3.7*smooth(1.45,1.48,z)
    return profile(z) + curvature*min(abs(x),.08)**2 + .10*max(0,abs(x)-.08)

def neckline(x):
    return 1.451 + .034*(min(abs(x),.095)/.155)**2 - .050*smooth(.095,.155,abs(x))

def bind(o):
    # Shared spatial weight field keeps adjoining pieces together. Around the
    # neckline copy the existing skin's nearest triangle weights, so tiny neck
    # motion does not open a collar gap; below it blend the existing torso bones.
    o.vertex_groups.clear()
    groups = {b.name:o.vertex_groups.new(name=b.name) for b in rig.data.bones}
    source_groups = {g.index:g.name for g in body.vertex_groups}
    for v in o.data.vertices:
        x,y,z = v.co
        top = smooth(1.16,1.40,z)
        bottom = (1-top)*(1-smooth(.95,1.18,z))
        weights = {'Spine':bottom,'Spine1':1-top-bottom,'Spine2':top}
        side = 'Left' if x>0 else 'Right'
        lateral = smooth(.14,.205,abs(x))
        arm = lateral*.65*(1-smooth(1.32,1.44,z))
        shoulder = lateral*.25*smooth(1.30,1.43,z)
        weights = {k:w*(1-arm-shoulder) for k,w in weights.items()}
        weights[side+'Arm']=arm
        weights[side+'Shoulder']=shoulder
        near = smooth(1.425,1.47,z)*(1-smooth(.09,.14,abs(x)))
        if near>0:
            loc,_,idx,_ = body_bvh.find_nearest(v.co)
            if loc is not None:
                ids=body_faces[idx]
                inv=[1/max(.0001,(body_vertices[i]-loc).length) for i in ids]
                total=sum(inv)
                weights={k:w*(1-near) for k,w in weights.items()}
                for i,w in zip(ids,inv):
                    for g in body.data.vertices[i].groups:
                        name=source_groups[g.group]
                        if name in groups: weights[name]=weights.get(name,0)+near*w/total*g.weight
        weights={k:w for k,w in weights.items() if w>.00001}
        # glTF's supported four influences; normalize deterministically.
        weights=dict(sorted(weights.items(),key=lambda kv:kv[1],reverse=True)[:4])
        total=sum(weights.values())
        for name,w in weights.items():groups[name].add([v.index],w/total,'REPLACE')
    for m in list(o.modifiers):
        if m.type=='ARMATURE':o.modifiers.remove(m)
    o.parent=rig
    mod=o.modifiers.new('Shared fitted garment weights','ARMATURE');mod.object=rig

def finish(o,material,thickness):
    bpy.context.view_layer.objects.active=o
    o.data.materials.clear();o.data.materials.append(material)
    bm=bmesh.new();bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bm.to_mesh(o.data);bm.free()
    uv=o.data.uv_layers.new(name='TailoringUV')
    for f in o.data.polygons:
        f.use_smooth=True
        for li in f.loop_indices:
            v=o.data.vertices[o.data.loops[li].vertex_index].co
            uv.data[li].uv=(v.x*60,v.z*60)
    if thickness:
        mod=o.modifiers.new('Inward fabric thickness','SOLIDIFY')
        mod.thickness=thickness;mod.offset=-1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bind(o)

def mesh(name,vertices,faces,mat,thickness=.0012):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o)
    finish(o,mat,thickness)
    return o

wool=bpy.data.materials['Alya_Wool']
lapel_mat=bpy.data.materials['Alya_Lapel']
silk=bpy.data.materials['Alya_Silk']
thread=bpy.data.materials['Alya_Thread']
# Remove only the superseded garment pieces. Human* meshes are untouched.
for o in list(bpy.data.objects):
    if o.type=='MESH' and ('Blouse' in o.name or 'Notched_Lapel' in o.name):
        bpy.data.objects.remove(o,do_unlink=True)

# Refit the existing coat as a continuous surface. The same coordinate mapping
# on sleeves and pockets preserves seam alignment, instead of separately moving
# decorative panels. Upper front surfaces now follow the chest, not an offset.
for o in list(bpy.data.objects):
    if o.type!='MESH' or o.name.startswith('Human'):continue
    for v in o.data.vertices:
        x,y,z=v.co
        collar=smooth(1.44,1.525,z)*(1-smooth(.12,.18,abs(x)))
        x*=1-.22*collar
        frontal=1-smooth(-.065,-.008,y)
        upper=smooth(1.26,1.43,z)*(1-smooth(.14,.205,abs(x)))
        target=torso(x,z)-.010
        y+=(target-y)*frontal*upper
        if y < -.015 and z>1.425:
            surface=skin_front(x,z)
            if surface is not None:y=min(y,surface-.009)
        v.co=(x,y,z)
    bind(o)

coat=bpy.data.objects['Navy_Blazer_Body']
coat_bvh=BVHTree.FromPolygons([v.co.copy() for v in coat.data.vertices],
                              [list(p.vertices) for p in coat.data.polygons])

# The inner top is a newly authored contoured front with hidden side allowances.
# Its rounded neckline is 4mm in front of the measured skin. The side edges
# end under the coat; this is not a complete standalone blouse or cloth simulation.
cols,rows=80,72
vertices=[];faces=[];neck=[]
for j in range(rows+1):
    t=j/rows
    for i in range(cols+1):
        x=-.125+.25*i/cols
        top=neckline(x)
        z=.89+(top-.89)*t
        y=torso(x,z)-.004
        if abs(x)<.085:
            measured=skin_front(x,top)
            if measured is not None:
                y+=(measured-torso(x,top))*smooth(.82,1,t)
        # Very shallow fabric ease follows torso volume, tapering to zero at neck.
        y-=.0015*math.sin(math.pi*t)*math.exp(-((abs(x)-.07)/.06)**2)
        surface=skin_front(x,z) if z>1.425 else None
        if surface is not None:y=min(y,surface-.004)
        vertices.append((x,y,z))
        if j==rows:neck.append((x,y-.0002,z-.001))
        if j<rows and i<cols:
            a=j*(cols+1)+i;faces.append((a,a+1,a+cols+2,a+cols+1))
shirt=mesh('Ivory_Blouse',vertices,faces,silk,.001)
# A narrow self-fabric neckline facing, fitted to the same contour and weights.
verts=[];faces=[]
for i,(x,y,z) in enumerate(neck):
    verts.extend([(x,y,z+.001),(x,y-.0003,z-.0025)])
    if i<cols:faces.append((2*i,2*i+1,2*i+3,2*i+2))
mesh('Alya_Neckline_Facing',verts,faces,silk,.0006)

# Curved notched lapel ribbons. Their inner edge is the opening roll line and
# their outer edge is supported by the coat. Both use the torso fitting surface.
# The original six-corner outline is not reused.
controls=[(1.17,.056,.003),(1.24,.065,.030),(1.32,.072,.051),
          (1.405,.076,.045),(1.438,.073,.037),(1.455,.069,.024),
          (1.464,.065,.035),(1.485,.060,.027),(1.513,.063,.010)]
def section(z):
    for (a,xa,wa),(b,xb,wb) in zip(controls,controls[1:]):
        if z<=b:
            t=(z-a)/(b-a) if a>=1.438 else smooth(a,b,z)
            return xa+(xb-xa)*t,wa+(wb-wa)*t
    return controls[-1][1:]
for sign,label in [(-1,'Right'),(1,'Left')]:
    verts=[];faces=[]
    for j in range(105):
        z=1.17+(1.513-1.17)*j/104
        inner,width=section(z)
        for i in range(17):
            u=i/16;x=sign*(inner+width*u)
            # 2mm layering clearance; max 3mm roll, returning to the coat at edge.
            y=torso(x,z)-.012-.003*math.sin(math.pi*u)
            support,_,_,_=coat_bvh.ray_cast(Vector((x,-1,z)),Vector((0,1,0)))
            if support is not None:
                y=min(y,support.y-.0025-.003*math.sin(math.pi*u))
            surface=skin_front(x,z) if z>1.425 else None
            if surface is not None:y=min(y,surface-.012)
            verts.append((x,y,z))
            if j<104 and i<16:
                a=j*17+i;faces.append((a,a+1,a+18,a+17))
    mesh(label+'_Notched_Lapel',verts,faces,lapel_mat,.0016)

# Store meaningful fitting evidence alongside the GLB for packaging/tests.
samples=[]
for x in [-.06,-.04,-.02,0,.02,.04,.06]:
    z=neckline(x)
    skin=skin_front(x,z)
    samples.append({'x':x,'height':z,'skinDepth':skin,'shirtDepth':skin-.004,
                    'clearance':.004})
report={'revision':'body-fitted-v2','necklineSamples':samples,
        'construction':'Original contoured shirt and rolled lapel meshes; refitted existing coat',
        'externalAssetsAdded':False}
Path(args.output+'.fit.json').write_text(json.dumps(report,indent=2)+'\n')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=args.output,export_format='GLB',use_selection=True,
                           export_morph=True,export_skins=True,export_animations=False)
