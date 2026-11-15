"""Build the AIYOU miniature from original procedural Blender meshes."""
import bpy, math, random, sys, pathlib, collections
from mathutils import Vector
from math import sin, cos, pi
out = pathlib.Path(sys.argv[sys.argv.index("--")+1])
out.mkdir(parents=True, exist_ok=True)
random.seed(78)
bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene
palette = dict(grass="5F7045", grassLight="7F8B5C", grassDark="43583A", tile="A89C87", grout="4C5150",
              cream="D4CAB5", ivory="E9E1CE", stone="827F73", gold="A6814C", teal="4C6962", tealLight="91AAA0",
              blue="4B6777", violet="615A7E", lavender="ABA0C6", coral="8F513C", apricot="BD8A68",
              mint="88955D", moss="304B38", wood="70503A", ink="1D2B33", white="E6ECE8",
              leaf="365638", leaf2="557044", leaf3="779059", amber="9F793A", water="285A60",
              ripple="537B78", path="897D68", rail="2B3A3E", violetRail="8B79B6", coralRail="AF7659",
              cyanRail="7C9D89", yellow="C4B26D", purple="9A84A5", rose="AE777D", glass="526A6D",
              basalt="434B4B", copper="996644", brick="9C6C55", lightBrick="AB7D65", mortar="B1A18B",
              pane="30474D", lit="C5A87A", steel="586971", roof="353F47", gravel="746A53",
              darkLeaf="254331", groundShade="35432A", sediment="5C6042", stucco="B5AE9B")
def linear(v): return v/12.92 if v<.04045 else ((v+.055)/1.055)**2.4
def rgba(h): return tuple(linear(int(h[i:i+2],16)/255) for i in [0,2,4])+(1,)
materials={}
for n,h in palette.items():
    c=rgba(h)
    m=bpy.data.materials.new(n);m.diffuse_color=c;m.use_nodes=True
    b=m.node_tree.nodes.get("Principled BSDF"); b.inputs["Base Color"].default_value=c
    b.inputs["Roughness"].default_value={
        "water":.18,"ripple":.26,"glass":.20,"pane":.19,"gold":.38,
        "copper":.38,"steel":.37,"roof":.57,"tile":.80,"grout":.92,
        "grass":.98,"gravel":.97,"wood":.77,"stucco":.89,"brick":.91,
    }.get(n,.74)
    b.inputs["Metallic"].default_value={
        "gold":.46,"rail":.54,"steel":.60,"copper":.65,"roof":.43,"glass":.29,"pane":.25,
    }.get(n,0)
    if n in {"lit","white"}:
        b.inputs["Emission Color"].default_value=c
        b.inputs["Emission Strength"].default_value=.28 if n=="lit" else .08
    materials[n]=m

def terrain_texture():
    # Packed tile exported by glTF; editable without external downloads.
    from mathutils.noise import noise
    import struct, zlib
    size=384
    rng=random.Random(208)
    pixels=bytearray()
    def encode(v): return round((12.92*v if v<=.00313 else 1.055*v**(1/2.4)-.055)*255)
    def chunk(key,value):
        return struct.pack("!I",len(value))+key+value+struct.pack("!I",zlib.crc32(key+value))
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            u,v=x/size,y/size
            low=noise((u*9,v*9,12),noise_basis='PERLIN_ORIGINAL')
            mid=noise((u*41,v*41,5),noise_basis='PERLIN_ORIGINAL')
            hi=noise((u*144,v*144,26),noise_basis='PERLIN_ORIGINAL')
            speck=rng.uniform(-.23,.23)
            f=max(0,min(1,.51+low*.38+mid*.23+hi*.11+speck*.25))
            brown=max(0,-low-.12)*.30
            pixels.extend(map(encode,(.049+f*.097+brown,.070+f*.136,.025+f*.059+brown*.30)))
    source=out/"._terrain-generated.png"
    source.write_bytes(b"\x89PNG\r\n\x1a\n"+
                       chunk(b"IHDR",struct.pack("!IIBBBBB",size,size,8,2,0,0,0))+
                       chunk(b"IDAT",zlib.compress(pixels,6))+chunk(b"IEND",b""))
    image=bpy.data.images.load(str(source));image.name="AIYOU terrain • fine grass and soil"
    image.pack();source.unlink()
    nodes=materials["grass"].node_tree.nodes
    texture=nodes.new("ShaderNodeTexImage"); texture.image=image
    texture.interpolation='Linear'
    links=materials["grass"].node_tree.links
    links.new(texture.outputs['Color'],nodes.get("Principled BSDF").inputs["Base Color"])
terrain_texture()
bucket=collections.defaultdict(list)
zone="Park"
def finish(o,n,m,bevel=0,smooth=False):
    o.name=n;o.data.materials.append(materials[m])
    if bevel:
        b=o.modifiers.new("Soft edges","BEVEL");b.width=bevel;b.segments=2
        bpy.context.view_layer.objects.active=o
        bpy.ops.object.modifier_apply(modifier=b.name)
    if smooth:
        for p in o.data.polygons:p.use_smooth=True
    bucket[(zone,m)].append(o)
    return o
def box(n,loc,dim,m,b=.035,rot=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.dimensions=dim
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.rotation_euler.z=rot
    return finish(o,n,m,b)
def cyl(n,loc,r,depth,m,v=40,b=.018):
    bpy.ops.mesh.primitive_cylinder_add(vertices=v,radius=r,depth=depth,location=loc)
    return finish(bpy.context.object,n,m,b)
def sphere(n,loc,scale,m,sub=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=loc)
    o=bpy.context.object;o.scale=scale
    return finish(o,n,m,0,sub>=2)
def beam(n,a,b,r,m):
    a,b=Vector(a),Vector(b); d=b-a
    o=cyl(n,(a+b)*.5,r,d.length,m,10,0)
    o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    return o
def strip(n,pts,r,m):
    c=bpy.data.curves.new(n,"CURVE");c.dimensions="3D";c.resolution_u=16;c.bevel_depth=r;c.bevel_resolution=1
    s=c.splines.new("BEZIER");s.bezier_points.add(len(pts)-1)
    for p,co in zip(s.bezier_points,pts):
        p.co=co;p.handle_left_type=p.handle_right_type="AUTO"
    o=bpy.data.objects.new(n,c);S.collection.objects.link(o)
    bpy.ops.object.select_all(action="DESELECT");o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target="MESH")
    return finish(bpy.context.object,n,m)
def pad(x,y,r,accent):
    cyl("Masonry foundation",(x,y,.06),r,.12,"grout",64)
    cyl("Stone terrace",(x,y,.13),r-.05,.11,"tile",64)
    cyl("Accent rim",(x,y,.215),r*.68,.12,accent,48)
    cyl("Work surface",(x,y,.285),r*.64,.10,"ivory",48)
    for row,rad,n in [(0,.76,30),(1,.895,36)]:
        for i in range(n):
            a=2*pi*(i+row*.5)/n
            box("Hand-set basalt and limestone",(x+r*rad*cos(a),y+r*rad*sin(a),.194),
                (r*.117,r*(rad*2*pi/n-.012),.034),random.choice(["tile","cream","stone","tile"]),.003,a)
    for i in range(3):
        box("Entry stair nosing",(x,y-r+.06+i*.09,.055+i*.041),(r*.43,.115,.055),"basalt",.006)
def lamp(x,y):
    cyl("Lamp base",(x,y,.17),.115,.17,"stone",12)
    cyl("Lamp post",(x,y,.48),.034,.61,"rail",10,0)
    sphere("Warm globe",(x,y,.81),(.087,.087,.087),"ivory",2)
def parcel(x,y,z,m="gold",r=.18):
    box("Task parcel",(x,y,z),(r*2,r*1.65,r*1.65),m,.025)
    box("Paper seal",(x,y,z+r*.84),(r*.6,r*1.67,.016),"ivory",.003)

# Single flush ground surface extends beyond every usual camera framing.
def terrain():
    mesh=bpy.data.meshes.new("Landscape mesh")
    mesh.from_pydata([(-33,-30,.002),(33,-30,.002),(33,30,.002),(-33,30,.002)],[],[(0,1,2,3)])
    mesh.update()
    uv=mesh.uv_layers.new(name="Ground tile")
    for i,coords in enumerate([(0,0),(4.5,0),(4.5,4.1),(0,4.1)]):uv.data[i].uv=coords
    ground=bpy.data.objects.new("Continuous grass landscape",mesh);S.collection.objects.link(ground)
    finish(ground,"Continuous grass landscape","grass")
terrain()
for x,y,w in [(-6,0,4.3),(6,0,4.3),(0,3.2,2.2),(0,-4.5,3.0)]:
    if x:
        box("Walkway",(x,y,.016),(w*2,.61,.034),"path",.04)
        for i in range(18): box("Path flagstone",(x-w+i*w/9,y,.035),(.42,.39,.027),"tile",.03)
    else:
        box("Walkway",(x,y,.015),(.64,w*2,.034),"path",.04)
        for i in range(12): box("Path flagstone",(x,y-w+i*w/6,.034),(.39,.31,.022),"tile",.026)

stations={"intake":(0,0,2.38),"verify":(-5.15,3.05,1.93),"next":(-5.1,-3.16,1.89),
          "dsh":(0,5.3,1.64),"claude":(5.23,3.0,1.94),"codex":(5.29,-3.04,2.03)}
routes={"verify": [(-1.77,.62),(-3.0,1.04),(-3.63,2.24)], "next":[(-1.69,-.8),(-2.85,-1.31),(-3.6,-2.69)],
        "dsh":[(.23,2),(.64,3.05),(.39,4.12)],"claude":[(1.66,.71),(2.99,1.28),(3.83,2.53)],
        "codex":[(1.61,-.94),(2.91,-1.32),(3.88,-2.58)]}
for key, pts in routes.items():
    zone="Routes"
    color={"claude":"coralRail","codex":"violetRail","dsh":"cyanRail","next":"coralRail","verify":"cyanRail"}[key]
    strip("Conveyor underlay",[(x,y,.07) for x,y in pts],.17,"rail")
    for side in [-1,1]:
        strip("Conveyor edge",[(x,y+side*.145,.13) for x,y in pts],.028,color)
    for x,y in pts: parcel(x,y,.23,color,.12)
zone="Intake"
pad(0,0,2.38,"gold")
cyl("Round reception wall",(0,0,.66),1.56,.67,"cream")
cyl("Ring cornice",(0,0,1.035),1.63,.13,"tealLight")
cyl("Canopy ridge",(0,0,1.17),1.57,.15,"glass")
cyl("Circular lower glazing",(0,0,.87),1.585,.32,"glass",64)
for level,z0,z1,r0,r1 in [(0,1.23,1.49,1.51,1.10),(1,1.49,1.68,1.10,.68),(2,1.68,1.77,.68,.30)]:
    for segment in range(20):
        a=2*pi*(segment+.06)/20
        b=2*pi*(segment+.94)/20
        mesh=bpy.data.meshes.new("Curved pavilion glass")
        mesh.from_pydata([(r0*cos(a),r0*sin(a),z0),(r0*cos(b),r0*sin(b),z0),
                          (r1*cos(b),r1*sin(b),z1),(r1*cos(a),r1*sin(a),z1)],[],[(0,1,2,3)])
        mesh.update()
        o=bpy.data.objects.new("Jointed skylight glass",mesh);S.collection.objects.link(o)
        finish(o,"Jointed skylight glass",["glass","tealLight","pane","glass","glass"][((segment+level)%5)])
    for segment in range(20):
        a=2*pi*segment/20;b=2*pi*(segment+1)/20
        beam("Skylight seam",(r1*cos(a),r1*sin(a),z1),(r1*cos(b),r1*sin(b),z1),.011,"steel")
for i in range(14):
    a=2*pi*i/14
    x,y=1.574*cos(a),1.574*sin(a)
    cyl("Facade column",(x,y,.73),.065,.77,"ivory",12)
    if y<-.8:
        box("Door threshold",(x,y,.33),(.25,.25,.07),"wood",.01)
cyl("Central tower",(0,0,1.43),.31,.65,"tealLight")
cyl("Tower rim",(0,0,1.75),.39,.08,"ivory")
sphere("Beacon",(0,0,1.88),(.26,.26,.23),"coral",3)
for i in range(10):
    a=i*2*pi/10
    strip("Glass pavilion rib",[(1.52*cos(a),1.52*sin(a),1.24),(.91*cos(a),.91*sin(a),1.58),(.28*cos(a),.28*sin(a),1.8)],.029,"ivory")
for i in range(8):
    a=i*2*pi/8
    if i not in [0,4]: lamp(2.12*cos(a),2.12*sin(a))

def panes(x,y,z,width,height,side="south",n=3):
    if side=="south":
        box("Dark metal jamb",(x,y,z),(width+.045,.040,height+.056),"steel",.007)
        for i in range(n):
            box("Double-glazed pane",(x-width/2+(i+.5)*width/n,y-.027,z),
                (width/n-.019,.018,height-.025), "lit" if i==1 else "pane",.003)
        box("Limestone sill",(x,y-.045,z-height/2),(width+.09,.092,.045),"tile",.008)
    else:
        box("East jamb",(x,y,z),(.040,width+.045,height+.056),"steel",.007)
        for i in range(n):
            box("East double-glazed pane",(x+.027,y-width/2+(i+.5)*width/n,z),
                (.018,width/n-.019,height-.025), "lit" if i==1 else "pane",.003)
        box("East sill",(x+.045,y,z-height/2),(.092,width+.09,.045),"tile",.008)

def terminal(x,y,z,color):
    box("Door canopy",(x,y-.075,z+.57),(.70,.39,.085),"roof",.014)
    box("Door surround",(x,y,z+.28),(.47,.061,.58),"steel",.012)
    box("Glazed entry",(x,y-.038,z+.28),(.39,.032,.51),"pane",.005)
    box("Bronze pull",(x+.13,y-.059,z+.28),(.025,.024,.17),"gold",.003)
    box("Threshold",(x,y-.115,z-.018),(.61,.25,.048),"tile",.008)
    box("Room-number sign",(x+.33,y-.033,z+.43),(.17,.040,.13),color,.009)

def pitched(x,y,base,width,depth,color):
    a=.40; half=depth*.51
    for sign in [-1,1]:
        z=base+half/2*math.tan(a)
        r=box("Standing seam roof",(x,y+sign*half/2,z),(width+.17,half/cos(a)+.045,.075),color,.012)
        r.rotation_euler.x=-sign*a
        for j in range(9):
            q=box("Roof seam",(x-width*.5+j*width/8,y+sign*half/2,z+.044),(.016,half/cos(a)+.037,.024),"steel",.003)
            q.rotation_euler.x=-sign*a
    beam("Ridge cap",(x-width*.54,y,base+half*math.tan(a)+.057),(x+width*.54,y,base+half*math.tan(a)+.057),.034,"steel")

def facade_station(key,color,light):
    global zone
    zone=key.title();x,y,r=stations[key]
    pad(x,y,r,color)
    pz=.337
    if key=="codex":
        # Two-storey slate workshop with clerestory and rooftop plant.
        box("Lower concrete core",(x-.16,y+.06,.76),(1.83,1.51,.84),"stucco",.018)
        box("Second-floor slab",(x-.16,y+.06,1.175),(1.92,1.60,.12),"stone",.016)
        box("Setback studio", (x-.21,y+.20,1.49),(1.59,1.20,.57),"cream",.018)
        for dx in [-.83,-.62,-.41,-.20,.01,.22,.43]:
            box("Vertical charcoal mullion",(x+dx,y-.418,1.51),(.045,.07,.54),"roof",.006)
        panes(x-.20,y-.458,1.5,1.41,.42,n=7)
        box("Folded slate parapet",(x-.20,y+.16,1.81),(1.72,1.34,.11),color,.021)
        box("Roof zinc cladding",(x-.20,y+.16,1.876),(1.68,1.30,.04),"roof",.01)
        box("Mechanical housing",(x+.30,y+.45,1.99),(.37,.43,.22),"steel",.02)
        for j in range(5): box("Cooling grille",(x+.30,y+.23,1.934+j*.030),(.27,.025,.012),"ink",.003)
        terminal(x-.56,y-.710,pz,color)
        panes(x+.24,y-.708,.802,.63,.53,n=3)
        panes(x+.765,y+.11,.83,.92,.47,"east",4)
        xlamp,ylamp=x+1.08,y-.93
    elif key=="claude":
        # Warm masonry annex with standing seam gabled roof.
        box("Masonry wall",(x,y+.07,.821),(1.72,1.35,.96),"brick",.014)
        for layer in range(9):
            z=.388+layer*.093
            for j in range(6):
                dx=-.70+(j+.4*(layer%2))*.25
                if abs(dx)>.77:continue
                box("Masonry facing",(x+dx,y-.608,z),(.235,.023,.080),"lightBrick" if (j+layer)%4==0 else "brick",.004)
        pitched(x,y+.07,1.29,1.72,1.35,"roof")
        box("Chimney",(x+.49,y+.25,1.54),(.29,.27,.53),"brick",.014)
        box("Chimney cap",(x+.49,y+.25,1.812),(.36,.35,.068),"basalt",.01)
        terminal(x-.49,y-.637,pz,color)
        panes(x+.33,y-.639,.851,.69,.51,n=3)
        panes(x+.865,y+.045,.845,1.06,.51,"east",3)
        xlamp,ylamp=x+1.03,y-.86
    else:
        # Green copper pavilion with meeting-room glazing.
        box("Pavilion deck",(x,y+.10,.383),(1.79,1.40,.10),"tile",.018)
        box("Pavilion wall",(x,y+.18,.843),(1.58,1.19,.86),"cream",.018)
        box("Green zinc perimeter",(x,y+.10,1.292),(1.85,1.40,.14),color,.020)
        roof=box("Raised monitor roof",(x,y+.17,1.47),(1.59,1.19,.24),"steel",.025)
        roof.rotation_euler.x=.14
        for j in range(7): box("Roof standing seam",(x-.65+j*.218,y+.17,1.591),(.021,1.13,.022),color,.005).rotation_euler.x=.14
        panes(x-.06,y-.435,.828,1.39,.56,n=6)
        panes(x+.806,y+.145,.818,.98,.56,"east",4)
        box("Wraparound canopy",(x,y-.43,1.16),(1.80,.60,.065),light,.011)
        for dx in [-.78,.78]:beam("Copper canopy stay",(x+dx,y-.644,.446),(x+dx,y-.644,1.128),.020,"copper")
        xlamp,ylamp=x+.97,y-.76
    lamp(xlamp,ylamp)
    for dx,dy in [(-1.02,.83),(1.01,.92)]:
        box("Stone planter",(x+dx,y+dy,.416),(.28,.29,.19),"stone",.017)
        sphere("Roof garden greenery",(x+dx,y+dy,.54),(.15,.15,.14),"moss",2)

facade_station("claude","coral","apricot")
facade_station("codex","violet","lavender")
facade_station("dsh","teal","tealLight")

zone="Verification"
x,y,r=stations["verify"];pad(x,y,r,"blue")
box("Workshop building",(x-.42,y+.26,.77),(1.52,1.39,.93),"cream",.075)
for i in [-1,1]:
    roof=box("Pitched roof",(x-.42,y+.26+i*.39,1.37),(1.78,.94,.16),"blue",.045)
    roof.rotation_euler.x=i*-.34
for dx in [-.91,-.42,.08]:
    box("Verification window",(x+dx,y-.455,.88),(.35,.07,.44),"glass",.035)
box("Review console",(x+.77,y-.20,.58),(.71,.69,.54),"stone",.055)
box("Review monitor",(x+.77,y-.27,.98),(.64,.23,.49),"rail",.043)
box("Monitor screen",(x+.77,y-.40,.98),(.48,.035,.30),"tealLight",.025)
beam("Check mark",(x+.64,y-.425,1.00),(x+.74,y-.425,.91),.028,"moss")
beam("Check mark",(x+.74,y-.425,.91),(x+.90,y-.425,1.07),.028,"moss")
parcel(x+.74,y+.61,.47,"lavender",.19);lamp(x-1.24,y-.80)

zone="Continuation"
x,y,r=stations["next"];pad(x,y,r,"gold")
box("Handoff workshop",(x-.42,y+.25,.76),(1.48,1.26,.90),"cream",.055)
box("Handoff canopy",(x-.42,y+.23,1.25),(1.68,1.46,.17),"apricot",.05)
box("Handoff door",(x-.42,y-.402,.75),(.54,.07,.66),"glass",.034)
for dx in [-.93,.08]:
    box("Handoff shutter",(x+dx,y-.408,.90),(.29,.08,.37),"blue",.025)
cyl("Relay signal base",(x+.73,y+.22,.46),.43,.24,"stone")
cyl("Relay mast",(x+.73,y+.22,.99),.10,1.03,"wood",14)
sphere("Relay light",(x+.73,y+.22,1.57),(.20,.20,.20),"gold",3)
for a in range(4):
    t=a*pi/2+.22
    o=box("Wind relay vane",(x+.73+.32*cos(t),y+.16,1.6+.32*sin(t)),(.47,.09,.17),"ivory",.028)
    o.rotation_euler.y=-t
for dx in [.36,.78]: parcel(x+dx,y-.80,.27,"apricot",.15)
lamp(x-1.14,y-.69)

zone="Park"
def free(x,y,margin=.10):
    return all((x-sx)**2+(y-sy)**2>(r+margin)**2 for sx,sy,r in stations.values()) and not (abs(x)<.53 or abs(y)<.45)
# Pond, stone ring and lily pads.
px,py=1.44,-4.28
for n,r,z,h,m in [("Pond rim",1.27,.018,.04,"stone"),("Pond water",1.12,.043,.024,"water"),("Pond shallows",.95,.057,.015,"ripple")]:
    o=cyl(n,(px,py,z),r,h,m,52,0);o.scale.y=.68
for i in range(13):
    a=random.uniform(0,2*pi);r=random.uniform(.12,.88)
    x=px+r*cos(a);y=py+r*.67*sin(a)
    cyl("Lily pad",(x,y,.079),random.uniform(.07,.13),.015,"mint",10,0)
    if i%4==0:sphere("Lily flower",(x,y,.106),(.052,.052,.03),"rose",2)
for i in range(95):
    x,y=random.uniform(-11.8,11.8),random.uniform(-8.4,9.8)
    if not free(x,y,.63) or (x-px)**2+(y-py)**2<2.25 or (abs(x)<7.7 and -3.7<y<4.2 and random.random()<.84):continue
    h=random.uniform(.50,1.28)
    cyl("Tree trunk",(x,y,h*.37),h*.056,h*.74,"wood",9,0)
    color=random.choices(["leaf","leaf2","leaf3","amber"],[3,4,3,1])[0]
    sphere("Bark mulch",(x,y,.012),(h*.39,h*.31,.022),"sediment",1)
    for j in range(7):
        a=j*2*pi/7+random.uniform(-.18,.18);size=h*random.uniform(.19,.27)
        spread=h*random.uniform(.13,.30);height=h*random.uniform(.75,1.16)
        if j<3:
            beam("Lateral tree branch",(x,y,h*.46),(x+cos(a)*spread,y+sin(a)*spread,height),h*.023,"wood")
        tint=color if j<4 else ("leaf2" if color=="leaf" else "leaf3" if color=="leaf2" else color)
        sphere("Mixed tree canopy",(x+cos(a)*spread,y+sin(a)*spread,height),
            (size*1.35,size,size*random.uniform(.78,1.35)),tint,2)
for i in range(235):
    x,y=random.uniform(-10.6,10.6),random.uniform(-7.3,7.8)
    if not free(x,y,.04) or (x-px)**2+(y-py)**2<1.64:continue
    if i%8==0:
        h=random.uniform(.15,.37)
        sphere("Shrub",(x,y,h*.44),(h,h*.82,h*.70),random.choice(["leaf2","leaf3","moss"]),2)
    elif i%3==0:
        for j in range(3):
            dx=random.uniform(-.14,.14);dy=random.uniform(-.15,.15);h=random.uniform(.085,.23)
            beam("Flower stem",(x+dx,y+dy,.03),(x+dx,y+dy,h),.008,"leaf")
            sphere("Wildflower",(x+dx,y+dy,h),(.039,.039,.05),random.choice(["purple","ivory","yellow","rose"]),1)
    else:
        sphere("Clover",(x,y,.024),(.11,.09,.023),random.choice(["grassLight","grassDark","mint"]),1)
for x,y in [(-2.6,-4.72),(3.19,4.81),(7.05,-1.08),(-7.19,1.38)]:
    box("Park bench seat",(x,y,.25),(.69,.26,.07),"wood",.024)
    box("Park bench back",(x,y+.115,.45),(.69,.065,.23),"wood",.02)
    for dx in [-.235,.235]: box("Bench leg",(x+dx,y,.115),(.07,.18,.22),"rail",.012)
# Batch the export into editable station/material groups and low draw calls.
for (group, mat), objs in bucket.items():
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:o.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]
    if len(objs)>1:bpy.ops.object.join()
    o=bpy.context.object;o.name=group+" • "+mat
    collection=bpy.data.collections.get(group)
    if collection is None:
        collection=bpy.data.collections.new(group);S.collection.children.link(collection)
    for c in list(o.users_collection):c.objects.unlink(o)
    collection.objects.link(o)
def point(o,where):o.rotation_euler=(Vector(where)-o.location).to_track_quat("-Z","Y").to_euler()
bpy.ops.object.camera_add(location=(.6,-16,17.8));cam=bpy.context.object
point(cam,(0,.58,.02));cam.data.type="ORTHO";cam.data.ortho_scale=17.1;S.camera=cam
bpy.ops.object.light_add(type="AREA", location=(-5.5,-5,12.5))
sun=bpy.context.object;sun.name="Warm daylight";sun.data.energy=2250;sun.data.shape="DISK";sun.data.size=5;point(sun,(0,0,0))
bpy.ops.object.light_add(type="AREA", location=(5,7,8))
fill=bpy.context.object;fill.name="Sky fill";fill.data.energy=820;fill.data.size=10;point(fill,(0,0,0))
S.world=bpy.data.worlds.new("Soft sky")
S.world.use_nodes=True
bg=S.world.node_tree.nodes.get("Background");bg.inputs[0].default_value=(.63,.76,.81,1);bg.inputs[1].default_value=.32
S.render.engine="CYCLES";S.cycles.samples=24;S.cycles.use_denoising=True
S.render.threads_mode="FIXED";S.render.threads=8
S.render.resolution_x=1440;S.render.resolution_y=920;S.render.resolution_percentage=100
S.view_settings.view_transform="AgX"
S.render.image_settings.file_format="PNG"
S.render.filepath=str(out/"任务大厅预览.png")
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.wm.save_as_mainfile(filepath=str(out/"AIYOU-3D任务大厅.blend"))
bpy.ops.export_scene.gltf(filepath=str(out/"task-hall.glb"),export_format="GLB",export_cameras=False,export_lights=False)
bpy.ops.render.render(write_still=True)
