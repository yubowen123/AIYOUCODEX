import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import "./hall-scene.css";

type Station = {
  id: string; name: string; xyz: [number, number, number]; radius: number; color: string;
  scale: number; kind: "core" | "builtin" | "annex"; usageCount: number | null; activeCount: number;
};
type AgentStation = { id: string; name: string; usageCount: number | null; activeCount: number };
const CORE = [
  { id:"intake", name:"任务大厅", xyz:[0, 2.34, 0], radius:2.38, color:"#c99a52" },
  { id:"verify", name:"检测站", xyz:[-5.15, 1.82, -3.05], radius:1.93, color:"#6386b0" },
  { id:"next", name:"续推站", xyz:[-5.1, 1.98, 3.16], radius:1.89, color:"#c47959" },
  { id:"automation", name:"自动任务", xyz:[-5.2, 2.76, -9.0], radius:1.69, color:"#4e748f" },
].map(item => ({...item, xyz:item.xyz as Station["xyz"], kind:"core", scale:1, usageCount:null, activeCount:0} as Station));
const BUILTIN = {
  dsh: { xyz:[0, 2.42, -5.3], radius:1.64, color:"#459483", group:"Dsh" },
  claude: { xyz:[5.23, 2.42, -3.0], radius:1.94, color:"#ce8765", group:"Claude" },
  codex: { xyz:[5.29, 2.42, 3.04], radius:2.03, color:"#8e7bdb", group:"Codex" },
} as const;
const TRACKS: Record<string, [number, number][]> = {
  verify: [[-1.77,.62],[-3,1.04],[-3.63,2.24]], next: [[-1.69,-.8],[-2.85,-1.31],[-3.6,-2.69]],
  dsh: [[.23,2],[.64,3.05],[.39,4.12]], claude: [[1.66,.71],[2.99,1.28],[3.83,2.53]],
  codex: [[1.61,-.94],[2.91,-1.32],[3.88,-2.58]],
  automation: [[-1.16,1.92],[-2.44,3.34],[-2.78,5.22],[-4.54,7.53]],
};
const CENTER = new THREE.Vector3(0, .02, -.58);
const BASE = import.meta.env.BASE_URL + "task-hall/";
const MAX_AGENTS = 48;
const COLORS = ["#ba8053","#586fbb","#398b7e","#bb7790","#5d8cb9","#a58f4e","#8a69b2","#689052"];
type Move = "home" | "left" | "right" | "in" | "out";
export type StationState = "running" | "completed" | "sleeping";
const STATE_LABEL:Record<StationState,string> = {running:"执行中",completed:"执行完成",sleeping:"休眠"};
const STATE_COLOR:Record<StationState,string> = {running:"#7affd3",completed:"#ffc46f",sleeping:"#8199a8"};
const ORBIT_DEFAULT = {azimuth:.11,elevation:.72,zoom:1};
const COMPLETE_MS=1750;
const DRAG_PX=5;
type Props = {
  activeStation: string | null; onStation:(id:string)=>void; occupied?:string[];
  stationCounts?:Record<string,number>; agentStations?:AgentStation[];
  stationStates?:Record<string,StationState>; stationCompletionKeys?:Record<string,string>;
};

function sizeFor(count: number | null) {
  return count == null || !Number.isFinite(count) ? 1
    : Math.min(1.26, .76 + Math.log1p(Math.max(0,count)) / Math.log1p(360) * .50);
}

function annexSlot(index: number): [number, number, number] {
  // Ordered fronts first, then the remaining perimeter. Size updates never
  // alter a slot; the next ring starts at a safe distance from the previous.
  const around = [0, 1, 17, 9, 8, 10, 2, 16, 7, 11, 3, 15, 6, 12, 4, 14, 5, 13];
  const ring = Math.floor(index / around.length);
  const angle = Math.PI / 18 + around[index % around.length] * Math.PI / 9;
  return [Math.cos(angle) * (13.6 + ring * 4.2), 2.18, Math.sin(angle) * (11.1 + ring * 4.2)];
}

function hashId(id: string) { return [...id].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,0); }

function stationLayout(agents: AgentStation[], slots: Map<string, number>) {
  const unique = new Map<string,AgentStation>();
  for (const agent of agents.slice(0, MAX_AGENTS)) if (agent.id && !CORE.some(s=>s.id===agent.id)) unique.set(agent.id,agent);
  for (const id of slots.keys()) if (!unique.has(id)) slots.delete(id);
  const used = new Set(slots.values());
  const agentsSorted = [...unique.values()].sort((a,b)=>a.id.localeCompare(b.id));
  return [...CORE,...agentsSorted.map((agent):Station=>{
    const scale=sizeFor(agent.usageCount);
    if(Object.hasOwn(BUILTIN,agent.id)) {
      const fixed=BUILTIN[agent.id as keyof typeof BUILTIN];
      return {...agent, xyz:[fixed.xyz[0],fixed.xyz[1],fixed.xyz[2]], radius:fixed.radius, color:fixed.color, scale, kind:"builtin"};
    }
    if(!slots.has(agent.id)){
      let open=0;
      while(used.has(open) || CORE.some(core=>{
        const [x,,z]=annexSlot(open);
        return Math.hypot(x-core.xyz[0],z-core.xyz[2])<core.radius+1.18*1.26+.27;
      }))open++;
      slots.set(agent.id,open);used.add(open);
    }
    return {...agent, xyz:annexSlot(slots.get(agent.id)!), radius:1.18, color:COLORS[hashId(agent.id)%COLORS.length], scale, kind:"annex"};
  })];
}

function makeTrack(station: Station) {
  const fixed = TRACKS[station.id];
  if (fixed) {
    const points=fixed.map(([x,y])=>new THREE.Vector3(x,.12,-y));
    const last=points.at(-1)!;
    const [x,,z]=station.xyz;
    last.lerp(new THREE.Vector3(x,.12,z), station.scale >= 1 ? 0 : (1-station.scale)*.85);
    return new THREE.CatmullRomCurve3(points);
  }
  const [x,,z]=station.xyz;
  const endpoint=new THREE.Vector3(x,.1,z);
  const direction=endpoint.clone().setY(0).normalize();
  const start=direction.clone().multiplyScalar(2.22).setY(.1);
  endpoint.addScaledVector(direction,-station.radius*station.scale*.87);
  const bend=start.clone().lerp(endpoint,.59);
  bend.add(new THREE.Vector3(-direction.z*.68,0,direction.x*.68));
  return new THREE.CatmullRomCurve3([start,bend,endpoint]);
}

export function HallScene({activeStation,onStation,occupied=[],stationCounts={},agentStations=[],stationStates={},stationCompletionKeys={}}:Props) {
  const stage=useRef<HTMLDivElement>(null), canvas=useRef<HTMLCanvasElement>(null);
  const labels=useRef(new Map<string,HTMLButtonElement>());
  const slots=useRef(new Map<string,number>());
  const move=useRef<(kind:Move)=>void>(()=>{});
  const select=useRef(onStation);
  const redraw=useRef<()=>void>(()=>{});
  const stations=stationLayout(agentStations,slots.current);
  const layout=useRef(stations);
  const activity=useRef(new Map<string,{state:StationState;key:string}>());
  const running=new Set([...occupied,...stations.filter(s=>s.activeCount>0).map(s=>s.id)]);
  layout.current=stations;
  activity.current=new Map(stations.map(({id})=>[id,{
    state:running.has(id)?"running":(stationStates[id]??"sleeping"),
    key:stationCompletionKeys[id]??"",
  }]));

  select.current=onStation;
  const layoutKey=JSON.stringify(stations.map(s=>[s.id,s.scale,s.xyz]));
  const activityKey=JSON.stringify([...activity.current]);
  useEffect(()=>{redraw.current();},[layoutKey,activityKey]);
  const [state,setState]=useState<"loading"|"ready"|"fallback">("loading");
  const [showLabels,setShowLabels]=useState(true);

  useEffect(()=>{
    if(!stage.current||!canvas.current)return;
    const surface=stage.current,element=canvas.current;
    let renderer:THREE.WebGLRenderer;
    try { renderer=new THREE.WebGLRenderer({canvas:element,antialias:true,powerPreference:"low-power"}); }
    catch { setState("fallback");return; }
    const camera=new THREE.OrthographicCamera();
    const scene=new THREE.Scene();
    scene.background=new THREE.Color("#52604c");
    scene.fog=new THREE.Fog("#788575",64,120);
    scene.add(new THREE.HemisphereLight("#e0eeff","#6b5943",1.57));
    const sun=new THREE.DirectionalLight("#fff0cf",3.22);
    sun.position.set(-15,15,10);
    sun.castShadow=true;
    Object.assign(sun.shadow.camera,{left:-27,right:27,top:27,bottom:-27,near:.1,far:76});
    sun.shadow.mapSize.set(2048,2048);
    sun.shadow.normalBias=.022;
    sun.shadow.bias=-.00016;
    scene.add(sun);
    const groundGeometry=new THREE.PlaneGeometry(70,70);
    const groundMaterial=new THREE.MeshStandardMaterial({color:"#677446",roughness:.98});
    const ground=new THREE.Mesh(groundGeometry,groundMaterial);
    ground.rotation.x=-Math.PI/2;ground.position.y=-.045;ground.receiveShadow=true;scene.add(ground);
    const cartGeometry=new THREE.BoxGeometry(.26,.26,.27);
    const trackMaterial=new THREE.MeshStandardMaterial({color:"#425c59",roughness:.9});
    const padGeometry=new THREE.CylinderGeometry(1.05,1.16,.17,24);
    const tileGeometry=new THREE.CylinderGeometry(.98,.98,.072,24);
    const houseGeometry=new RoundedBoxGeometry(1.30,.86,.92,2,.04);
    const wingGeometry=new RoundedBoxGeometry(.56,.60,.88,2,.035);
    const canopyGeometry=new RoundedBoxGeometry(1.49,.13,1.08,2,.025);
    const wingCanopyGeometry=new RoundedBoxGeometry(.62,.09,.99,2,.022);
    const capGeometry=new RoundedBoxGeometry(1.12,.08,.8,2,.022);
    const windowGeometry=new RoundedBoxGeometry(.79,.33,.046,2,.018);
    const windowMullion=new THREE.BoxGeometry(.021,.35,.025);
    const doorGeometry=new RoundedBoxGeometry(.32,.42,.04,2,.014);
    const jambGeometry=new RoundedBoxGeometry(.38,.47,.055,2,.023);
    const stepGeometry=new RoundedBoxGeometry(.56,.073,.25,2,.02);
    const tileSeamGeometry=new THREE.BoxGeometry(.72,.018,.022);
    const roofRibGeometry=new THREE.BoxGeometry(.022,.023,.79);
    const sillGeometry=new THREE.BoxGeometry(.87,.042,.09);
    const ledgeGeometry=new THREE.BoxGeometry(1.34,.046,.06);
    const shrubGeometry=new THREE.IcosahedronGeometry(.13,1);
    const antennaGeometry=new THREE.CylinderGeometry(.028,.037,.39,10);
    const beaconGeometry=new THREE.SphereGeometry(.095,12,8);
    const clockPaving=new THREE.CylinderGeometry(1.58,1.64,.13,40);
    const clockBase=new RoundedBoxGeometry(2.18,.91,1.55,2,.046);
    const clockCornice=new RoundedBoxGeometry(2.31,.14,1.68,2,.022);
    const clockTower=new RoundedBoxGeometry(.92,.78,.88,2,.025);
    const clockRoof=new THREE.ConeGeometry(.74,.44,4);
    const clockDial=new THREE.CircleGeometry(.24,40);
    const clockBezel=new THREE.CylinderGeometry(.275,.275,.041,40);
    const clockTick=new THREE.BoxGeometry(.024,.044,.012);
    const clockHand=new THREE.BoxGeometry(.034,.174,.015);
    const clockHandle=new THREE.SphereGeometry(.031,12,8);
    const clockPost=new THREE.BoxGeometry(.074,.80,.070);
    const clockBrick=new THREE.BoxGeometry(.223,.058,.014);
    const neutral=new THREE.MeshStandardMaterial({color:"#cfc3ad",roughness:.88});
    const light=new THREE.MeshStandardMaterial({color:"#c3bbab",roughness:.83});
    const metal=new THREE.MeshStandardMaterial({color:"#474e49",metalness:.5,roughness:.45});
    const baseMaterial=new THREE.MeshStandardMaterial({color:"#8b8980",roughness:.94});
    const foliage=new THREE.MeshStandardMaterial({color:"#557b45",roughness:1});
    const windowDark=new THREE.Color("#253b45");
    const ringGeometry=new THREE.RingGeometry(.94,1,56);
    const flareGeometry=new THREE.IcosahedronGeometry(.045,0);
    const fxGeometry=new THREE.SphereGeometry(.09,12,8);
    type StationFx={
      group:THREE.Group;ring:THREE.Mesh<THREE.RingGeometry,THREE.MeshBasicMaterial>;
      wave:THREE.Mesh<THREE.RingGeometry,THREE.MeshBasicMaterial>;lamp:THREE.Mesh<THREE.SphereGeometry,THREE.MeshBasicMaterial>;
      sparks:THREE.Mesh<THREE.IcosahedronGeometry,THREE.MeshBasicMaterial>[];
      mode:StationState;key:string;since:number;
    };
    const effects=new Map<string,StationFx>();
    const workerGroups=new Map<string,THREE.Group>();
    const annexes=new Map<string,{group:THREE.Group;paint:THREE.MeshStandardMaterial;window:THREE.MeshStandardMaterial}>();
    type PathRender = {track:THREE.CatmullRomCurve3;rail:THREE.Mesh;cart:THREE.Mesh;material:THREE.MeshStandardMaterial;scale:number};
    const paths=new Map<string,PathRender>();
    const reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)");
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.autoUpdate=false;
    renderer.shadowMap.type=THREE.PCFShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.01;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.65));
    let width=1,height=1,azimuth=ORBIT_DEFAULT.azimuth,elevation=ORBIT_DEFAULT.elevation,zoom=1;
    let model:THREE.Group|undefined,disposed=false,frame=0,ready=false,lastFrame=0;
    let lastLayout="", lastProjection="", projectionDirty=true;
    const pointers=new Map<number,{x:number;y:number}>();
    let grab:{x:number;y:number;azimuth:number;elevation:number;dragged:boolean}|null=null;
    let lastPinch=0, multipointer=false;
    const projected=new THREE.Vector3(),ray=new THREE.Raycaster(),floor=new THREE.Plane(new THREE.Vector3(0,1,0),-.11);
    function makeAnnex(station:Station) {
      const group=new THREE.Group();
      const paint=new THREE.MeshStandardMaterial({color:station.color,metalness:.20,roughness:.58});
      const window=new THREE.MeshStandardMaterial({color:windowDark,metalness:.14,roughness:.26,emissive:"#a7ffe1",emissiveIntensity:0});
      function piece(g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,angle=0) {
        const mesh=new THREE.Mesh(g,m);
        mesh.position.set(x,y,z);mesh.rotation.y=angle;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
      }
      piece(padGeometry,baseMaterial,0,.055,0);piece(tileGeometry,light,0,.16,0);
      piece(houseGeometry,neutral,-.08,.66,-.10);piece(wingGeometry,neutral,.58,.52,-.19);
      piece(canopyGeometry,metal,-.08,1.11,-.10);piece(capGeometry,paint,-.08,1.203,-.10);
      piece(wingCanopyGeometry,paint,.58,.85,-.18);
      piece(ledgeGeometry,baseMaterial,-.08,.39,.37);piece(ledgeGeometry,baseMaterial,-.08,.47,.37);
      piece(windowGeometry,window,-.16,.80,.37);piece(sillGeometry,metal,-.16,.61,.39);
      piece(windowGeometry,window,-.70,.80,-.10,Math.PI*.5);piece(sillGeometry,metal,-.70,.61,-.10,Math.PI*.5);
      for(const x of [-.40,-.16,.08])piece(windowMullion,metal,x,.80,.399);
      for(const z of [-.32,-.10,.12])piece(windowMullion,metal,-.727,.80,z,Math.PI*.5);
      piece(jambGeometry,metal,.48,.47,.315);piece(doorGeometry,paint,.48,.47,.355);
      piece(stepGeometry,baseMaterial,.46,.24,.47);piece(stepGeometry,light,.46,.196,.63);
      for(const x of [-.50,-.29,-.08,.13,.34])piece(roofRibGeometry,metal,x,1.25,-.10);
      for(const z of [.64,.81])piece(tileSeamGeometry,baseMaterial,-.20,.20,z);
      piece(antennaGeometry,metal,-.44,1.41,-.31);piece(beaconGeometry,paint,-.44,1.60,-.31);
      for(const [x,z] of [[-.67,.51],[-.82,.28],[.72,.38]])piece(shrubGeometry,foliage,x,.29,z);
      scene.add(group);
      return {group,paint,window};
    }
    function makeClockHouse(station:Station){
      const group=new THREE.Group();
      group.name="Automation clockhouse";
      const paint=new THREE.MeshStandardMaterial({color:"#425f6d",metalness:.34,roughness:.53});
      const window=new THREE.MeshStandardMaterial({color:windowDark,metalness:.14,roughness:.26,emissive:"#a7ffe1",emissiveIntensity:0});
      function piece(g:THREE.BufferGeometry,m:THREE.Material,x:number,y:number,z:number,angle=0){
        const mesh=new THREE.Mesh(g,m);
        mesh.position.set(x,y,z);mesh.rotation.y=angle;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
        return mesh;
      }
      piece(clockPaving,baseMaterial,0,.075,0);
      piece(clockPaving,light,0,.124,0).scale.set(.95,.36,.95);
      piece(clockBase,neutral,0,.68,-.14);
      piece(clockCornice,metal,0,1.158,-.14);
      piece(clockCornice,paint,0,1.234,-.14).scale.set(.94,.50,.94);
      piece(clockTower,neutral,0,1.60,-.15);
      piece(clockTower,paint,0,1.99,-.15).scale.set(1.08,.12,1.09);
      piece(clockRoof,paint,0,2.20,-.15,Math.PI/4);
      piece(antennaGeometry,metal,0,2.45,-.15).scale.set(.9,.40,.9);
      piece(clockHandle,light,0,2.54,-.15);
      // Each clock face is readable as the user orbits the scene.
      for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
        const dial=new THREE.Group();
        dial.position.set(Math.sin(angle)*.45,1.67,-.15+Math.cos(angle)*.45);
        dial.rotation.y=angle;
        const bezel=new THREE.Mesh(clockBezel,metal);
        bezel.rotation.x=Math.PI/2;dial.add(bezel);
        const face=new THREE.Mesh(clockDial,light);
        face.position.z=.022;dial.add(face);
        for(let i=0;i<12;i++){
          const a=i*Math.PI/6;
          const tick=new THREE.Mesh(clockTick,metal);
          tick.position.set(Math.sin(a)*.186,Math.cos(a)*.186,.028);
          tick.rotation.z=-a;tick.scale.y=i%3===0?1:.59;dial.add(tick);
        }
        for(const [angle,length] of [[-Math.PI/3,.92],[Math.PI/4,.66]]){
          const hand=new THREE.Mesh(clockHand,paint);
          hand.position.set(-Math.sin(angle)*.064*length,Math.cos(angle)*.064*length,.043);
          hand.rotation.z=angle;hand.scale.y=length;dial.add(hand);
        }
        const hub=new THREE.Mesh(clockHandle,metal);
        hub.position.z=.045;hub.scale.setScalar(.55);dial.add(hub);group.add(dial);
      }
      for(const x of [-.66,.66]){
        piece(windowGeometry,window,x,.79,.651).scale.set(.67,1.20,1);
        piece(sillGeometry,metal,x,.575,.673).scale.set(.64,1,1);
        piece(windowMullion,metal,x,.79,.680).scale.y=1.17;
      }
      piece(jambGeometry,metal,0,.48,.651).scale.set(1.12,1.12,1);
      piece(doorGeometry,paint,0,.48,.683).scale.set(1.11,1.12,1);
      piece(clockHandle,light,.11,.48,.71).scale.setScalar(.49);
      piece(stepGeometry,baseMaterial,0,.22,.77).scale.x=1.45;
      piece(stepGeometry,light,0,.18,.91).scale.x=1.60;
      for(const x of [-1.036,1.036]){
        piece(clockPost,metal,x,.671,.646);
        piece(windowGeometry,window,x*1.066,.79,-.10,Math.PI/2).scale.x=.93;
        piece(windowMullion,metal,x*1.094,.79,-.10,Math.PI/2);
      }
      for(const [n,y] of [.33,.405,.48].entries()){
        for(const x of [-.88,-.63,-.39,.39,.63,.88]){
          const stagger=(n%2===0?0:Math.sign(x)*.041);
          piece(clockBrick,n===1?light:baseMaterial,x+stagger,y,.640);
        }
      }
      for(let i=0;i<20;i++){
        const angle=i*Math.PI/10;
        piece(tileSeamGeometry,baseMaterial,Math.cos(angle)*1.42,.146,Math.sin(angle)*1.42,-angle).scale.x=.28;
      }
      for(const [x,z] of [[-1.07,.69],[1.09,.68],[.99,-.78]])piece(shrubGeometry,foliage,x,.21,z);
      scene.add(group);
      return {group,paint,window};
    }
    function makeEffect():StationFx {
      const group=new THREE.Group(),material=(opacity:number)=>new THREE.MeshBasicMaterial({
        transparent:true,opacity,depthWrite:false,toneMapped:false,side:THREE.DoubleSide,
      });
      const ring=new THREE.Mesh(ringGeometry,material(.55)),wave=new THREE.Mesh(ringGeometry,material(.40));
      ring.rotation.x=wave.rotation.x=-Math.PI/2;ring.position.y=.034;wave.position.y=.041;
      const lamp=new THREE.Mesh(fxGeometry,material(.84));
      const sparkMaterial=material(.84);
      const sparks=Array.from({length:10},()=>new THREE.Mesh(flareGeometry,sparkMaterial));
      for(const mesh of [ring,wave,lamp,...sparks]){mesh.renderOrder=5;group.add(mesh);}
      scene.add(group);
      return {group,ring,wave,lamp,sparks,mode:"sleeping",key:"",since:-Infinity};
    }
    function clearEffect(id:string,fx:StationFx){
      scene.remove(fx.group);
      for(const mesh of [fx.ring,fx.wave,fx.lamp,fx.sparks[0]])mesh.material.dispose();
      effects.delete(id);
    }
    function paintEffect(station:Station,now:number){
      const fx=effects.get(station.id);
      if(!fx)return false;
      const info=activity.current.get(station.id);
      const mode=info?.state??"sleeping",key=info?.key??"";
      if(mode!==fx.mode||(mode==="completed"&&key!==fx.key)){
        fx.mode=mode;fx.key=key;fx.since=now;
      }
      const calm=reducedMotion.matches;
      const fresh=mode==="completed"&&now-fx.since<COMPLETE_MS&&!calm;
      const beat=calm ? .42 : .5+.5*Math.sin(now*.0034+(hashId(station.id)%7));
      const burst=fresh ? THREE.MathUtils.clamp((now-fx.since)/COMPLETE_MS,0,1) : 1;
      const radius=station.radius*station.scale;
      const quiet=mode==="sleeping",working=mode==="running";
      const color=STATE_COLOR[mode];
      fx.ring.material.color.set(color);
      fx.ring.material.opacity=quiet?.22:working?.49+beat*.29:.79;
      fx.ring.scale.setScalar(radius*(quiet?.89:1.025));
      fx.wave.visible=working||fresh;
      fx.wave.material.color.set(color);
      fx.wave.material.opacity=fresh?(1-burst)*.69:(.20+beat*.20);
      fx.wave.scale.setScalar(radius*(fresh?1.01+burst*.4:1.05+beat*.08));
      fx.lamp.material.color.set(color);
      fx.lamp.material.opacity=quiet?.54:working?.70+beat*.26:.94;
      fx.lamp.scale.setScalar(quiet?.72:working?1+beat*.19:1.2);
      fx.lamp.position.y=Math.max(.40,(station.xyz[1]-.37)*station.scale);
      for(const [i,spark] of fx.sparks.entries()){
        spark.visible=fresh;
        if(fresh){
          const direction=i/10*Math.PI*2,spread=radius*(.42+burst*.66);
          spark.position.set(Math.cos(direction)*spread,.33+Math.sin(burst*Math.PI)*(i%3+1)*.28,Math.sin(direction)*spread);
          spark.scale.setScalar(1-burst*.6);
        }
      }
      if(fresh){fx.sparks[0].material.color.set(color);fx.sparks[0].material.opacity=(1-burst)*.91;}
      const annex=annexes.get(station.id);
      if(annex){
        annex.window.emissive.set(quiet?"#8db8d3":color);
        annex.window.emissiveIntensity=quiet?.10:working?.55+beat*.20:.78;
      }
      return (working||fresh)&&!calm;
    }
    function clearPath(id:string,value:PathRender) {
      scene.remove(value.cart,value.rail);value.rail.geometry.dispose();value.material.dispose();paths.delete(id);
    }
    function reconcile() {
      const current=layout.current;
      const stamp=JSON.stringify(current.map(s=>[s.id,s.scale,s.xyz]));
      if(stamp===lastLayout)return;
      lastLayout=stamp;
      const roster=new Map(current.map(station=>[station.id,station]));
      for(const [id,group] of workerGroups){
        const match=roster.get(id);group.visible=Boolean(match);
        if(match)group.scale.setScalar(match.scale);
      }
      for(const [id,annex] of annexes) if(!roster.has(id)){
        scene.remove(annex.group);annex.paint.dispose();annex.window.dispose();annexes.delete(id);
      }
      for(const [id,p] of paths) if(!roster.has(id) || roster.get(id)?.scale!==p.scale)clearPath(id,p);
      for(const [id,fx] of effects) if(!roster.has(id))clearEffect(id,fx);
      for(const station of current){
        const [x,,z]=station.xyz;
        if(station.kind==="annex"||station.id==="automation"){
          const annex=annexes.get(station.id)??(station.id==="automation"?makeClockHouse(station):makeAnnex(station));
          annex.group.position.set(x,.014,z);
          annex.group.scale.setScalar(station.scale);
          annexes.set(station.id,annex);
        }
        const fx=effects.get(station.id)??makeEffect();
        fx.group.position.set(x,station.kind==="annex"?.19:.21,z);
        effects.set(station.id,fx);
        if(station.id==="intake" || paths.has(station.id))continue;
        const track=makeTrack(station);
        // Peripheral rails appear only while the Agent is busy. Dormant
        // annexes remain distinct without covering the landscaped core.
        const rail=new THREE.Mesh(new THREE.TubeGeometry(track,16,station.kind==="annex"?.042:.088,6,false),trackMaterial);
        rail.receiveShadow=true;
        const material=new THREE.MeshStandardMaterial({color:station.color,emissive:station.color,emissiveIntensity:.30});
        const cart=new THREE.Mesh(cartGeometry,material);cart.visible=false;
        scene.add(rail,cart);paths.set(station.id,{track,rail,cart,material,scale:station.scale});
      }
      renderer.shadowMap.needsUpdate=true;
    }
    function draw(now:number){
      frame=0;
      if(disposed||!ready||document.hidden)return;
      if(!projectionDirty&&now-lastFrame<28){frame=requestAnimationFrame(draw);return;}
      lastFrame=now;
      reconcile();
      const projectionKey=[width,height,azimuth,elevation,zoom,lastLayout].join("|");
      const newProjection=projectionDirty||projectionKey!==lastProjection;
      if(newProjection){
        const aspect=width/height,reach=48;
        camera.position.copy(CENTER).add(new THREE.Vector3(reach*Math.cos(elevation)*Math.sin(azimuth),
          reach*Math.sin(elevation),reach*Math.cos(elevation)*Math.cos(azimuth)));
        camera.lookAt(CENTER);camera.updateMatrixWorld();
        let half=Math.max(16.7,9.9*aspect)/2;
        if(layout.current.some(s=>s.kind==="annex"||s.id==="automation")) {
          for(const station of layout.current){
            const [x,y,z]=station.xyz,r=station.radius*station.scale;
            const view=projected.set(x,0,z).applyMatrix4(camera.matrixWorldInverse);
            half=Math.max(half,Math.abs(view.x)+r+.88,(Math.abs(view.y)+r*.68+.88)*aspect);
            const nameplate=projected.set(x,y*station.scale,z).applyMatrix4(camera.matrixWorldInverse);
            half=Math.max(half,Math.abs(nameplate.x)+.92,(Math.abs(nameplate.y)+1.32)*aspect);
          }
        }
        half/=zoom;
        camera.left=-half;camera.right=half;camera.top=half/aspect;camera.bottom=-camera.top;
        camera.near=.1;camera.far=150;camera.updateProjectionMatrix();
        lastProjection=projectionKey;projectionDirty=false;
      }
      let anyMotion=false,index=0;
      for(const item of layout.current)anyMotion=paintEffect(item,now)||anyMotion;
      for(const [id,path] of paths){
        path.cart.visible=activity.current.get(id)?.state==="running";
        path.rail.visible=path.cart.visible || !id.startsWith("agent:");
        if(path.cart.visible) {
          path.track.getPointAt(reducedMotion.matches?.68:((now/3800+index*.17)%1),path.cart.position);
          path.cart.position.y+=.18;
        }
        index++;
      }
      renderer.render(scene,camera);
      if(newProjection)for(const item of layout.current){
        const label=labels.current.get(item.id);if(!label)continue;
        projected.set(item.xyz[0],item.xyz[1]*item.scale,item.xyz[2]).project(camera);
        const visible=Math.abs(projected.x)<.98&&Math.abs(projected.y)<.98;
        label.style.visibility=visible?"visible":"hidden";
        label.style.left=(projected.x*.5+.5)*100+"%";
        label.style.top=(.5-projected.y*.5)*100+"%";
      }
      if(anyMotion)frame=requestAnimationFrame(draw);
    }
    function requestDraw(){if(!frame&&!document.hidden)frame=requestAnimationFrame(draw);}
    function moveDraw(){projectionDirty=true;requestDraw();}
    redraw.current=moveDraw;
    function stopGrab(){
      for(const id of pointers.keys())if(element.hasPointerCapture?.(id))element.releasePointerCapture(id);
      pointers.clear();grab=null;lastPinch=0;multipointer=false;delete surface.dataset.dragging;
    }
    function visibility(){
      if(document.hidden){stopGrab();cancelAnimationFrame(frame);frame=0;}
      else requestDraw();
    }
    document.addEventListener("visibilitychange",visibility);
    reducedMotion.addEventListener("change",requestDraw);
    function resize(){
      width=Math.max(1,surface.clientWidth);height=Math.max(1,surface.clientHeight);
      renderer.setSize(width,height,false);moveDraw();
    }
    const observer=new ResizeObserver(resize);
    observer.observe(surface);resize();
    function changeZoom(factor:number){zoom=THREE.MathUtils.clamp(zoom*factor,.59,2.75);moveDraw();}
    move.current=kind=>{
      if(kind==="home"){({azimuth,elevation,zoom}=ORBIT_DEFAULT);}
      if(kind==="left")azimuth-=Math.PI/10;
      if(kind==="right")azimuth+=Math.PI/10;
      if(kind==="in")return changeZoom(1.22);
      if(kind==="out")return changeZoom(1/1.22);
      moveDraw();
    };
    function pick(clientX:number,clientY:number){
      if(!ready)return;
      const r=element.getBoundingClientRect();
      if(clientX<r.left||clientX>r.right||clientY<r.top||clientY>r.bottom)return;
      ray.setFromCamera(new THREE.Vector2((clientX-r.left)/r.width*2-1,-(clientY-r.top)/r.height*2+1),camera);
      // A hit on the raised clock house belongs to this station even when
      // its apparent silhouette is offset from its ground footprint.
      const clockhouse=annexes.get("automation")?.group;
      if(clockhouse&&ray.intersectObject(clockhouse,true).length){select.current("automation");return;}
      const point=ray.ray.intersectPlane(floor,new THREE.Vector3());
      if(!point)return;
      const hit=layout.current.map(x=>({x,d:Math.hypot(point.x-x.xyz[0],point.z-x.xyz[2])}))
        .filter(({x,d})=>d<=x.radius*x.scale).sort((a,b)=>a.d-b.d)[0];
      if(hit)select.current(hit.x.id);
    }
    const distance=()=>{
      const [a,b]=pointers.values();
      return b?Math.hypot(a.x-b.x,a.y-b.y):0;
    };
    function pointerDown(e:PointerEvent){
      if(!ready||e.button!==0||pointers.size>=2)return;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});element.setPointerCapture?.(e.pointerId);
      if(pointers.size===1){grab={x:e.clientX,y:e.clientY,azimuth,elevation,dragged:false};multipointer=false;}
      else {multipointer=true;lastPinch=distance();surface.dataset.dragging="true";}
    }
    function pointerMove(e:PointerEvent){
      if(!pointers.has(e.pointerId))return;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size===2){
        const current=distance();
        if(lastPinch>1&&current>1)changeZoom(current/lastPinch);
        lastPinch=current;return;
      }
      if(!grab||multipointer)return;
      const dx=e.clientX-grab.x,dy=e.clientY-grab.y;
      if(!grab.dragged&&Math.hypot(dx,dy)<DRAG_PX)return;
      grab.dragged=true;surface.dataset.dragging="true";
      azimuth=grab.azimuth-dx*.0083;
      elevation=THREE.MathUtils.clamp(grab.elevation+dy*.0063,.24,1.36);
      moveDraw();
    }
    function pointerEnd(e:PointerEvent){
      if(!pointers.delete(e.pointerId))return;
      const click=e.type==="pointerup"&&!pointers.size&&!multipointer&&grab&&!grab.dragged;
      if(!pointers.size){grab=null;lastPinch=0;multipointer=false;delete surface.dataset.dragging;}
      if(click)pick(e.clientX,e.clientY);
    }
    function wheel(e:WheelEvent){
      if(!ready||e.deltaY===0)return;
      e.preventDefault();
      const delta=e.deltaY*(e.deltaMode===1?15:e.deltaMode===2?height:1);
      changeZoom(Math.exp(-THREE.MathUtils.clamp(delta,-180,180)*.0024));
    }
    function keydown(e:KeyboardEvent){
      if(!ready)return;
      const key=e.key,keys:Record<string,Move>={ArrowLeft:"left",ArrowRight:"right","+":"in","=":"in","-":"out",Home:"home"};
      if(Object.hasOwn(keys,key)){e.preventDefault();move.current(keys[key]);return;}
      if(key==="ArrowUp"||key==="ArrowDown"){
        e.preventDefault();elevation=THREE.MathUtils.clamp(elevation+(key==="ArrowUp"?.11:-.11),.24,1.36);moveDraw();
      }
    }
    element.addEventListener("pointerdown",pointerDown);
    element.addEventListener("pointermove",pointerMove);
    element.addEventListener("pointerup",pointerEnd);
    element.addEventListener("pointercancel",pointerEnd);
    element.addEventListener("lostpointercapture",pointerEnd);
    element.addEventListener("wheel",wheel,{passive:false});
    element.addEventListener("keydown",keydown);
    window.addEventListener("blur",stopGrab);
    function release(group:THREE.Object3D){
      const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
      group.traverse(node=>{
        if(!(node instanceof THREE.Mesh))return;
        geometries.add(node.geometry);
        for(const material of Array.isArray(node.material)?node.material:[node.material])materials.add(material);
      });
      for(const material of materials){
        for(const prop of Object.values(material))if(prop instanceof THREE.Texture)textures.add(prop);
        material.dispose();
      }
      for(const texture of textures)texture.dispose();
      for(const geometry of geometries)geometry.dispose();
    }
    const fallback=()=>{ready=false;stopGrab();setState("fallback");
      for(const label of labels.current.values())label.removeAttribute("style");
    };
    element.addEventListener("webglcontextlost",fallback);
    new GLTFLoader().load(BASE+"task-hall-v2.glb",gltf=>{
      if(disposed){release(gltf.scene);return;}
      model=gltf.scene;
      model.traverse(node=>{
        if(node instanceof THREE.Mesh){node.castShadow=!node.name.includes("grass");node.receiveShadow=true;}
      });
      // The Blender GLB exports station/material batches as top-level meshes.
      // Pivot each batch group at its station base before applying usage scale.
      const children=[...model.children];
      for(const [id,fixed] of Object.entries(BUILTIN)){
        const group=new THREE.Group();group.position.set(fixed.xyz[0],0,fixed.xyz[2]);group.visible=false;
        model.add(group);
        for(const node of children.filter(x=>x.name.startsWith(fixed.group+"_•_") || x.name.startsWith(fixed.group+" • "))){
          group.attach(node);
        }
        workerGroups.set(id,group);
      }
      for(const child of children)if(child.name.startsWith("Routes_•_") || child.name.startsWith("Routes • "))child.visible=false;
      scene.add(model);
      ready=true;renderer.shadowMap.needsUpdate=true;
      setState("ready");requestDraw();
    },undefined,()=>{if(!disposed)fallback();});
    return ()=>{
      disposed=true;ready=false;cancelAnimationFrame(frame);observer.disconnect();stopGrab();
      element.removeEventListener("webglcontextlost",fallback);
      element.removeEventListener("pointerdown",pointerDown);element.removeEventListener("pointermove",pointerMove);
      element.removeEventListener("pointerup",pointerEnd);element.removeEventListener("pointercancel",pointerEnd);
      element.removeEventListener("lostpointercapture",pointerEnd);element.removeEventListener("wheel",wheel);
      element.removeEventListener("keydown",keydown);window.removeEventListener("blur",stopGrab);
      reducedMotion.removeEventListener("change",requestDraw);
      if(model)release(model);
      document.removeEventListener("visibilitychange",visibility);
      for(const [id,path] of paths)clearPath(id,path);
      for(const annex of annexes.values()){annex.paint.dispose();annex.window.dispose();}
      for(const [id,fx] of effects)clearEffect(id,fx);
      for(const resource of [groundGeometry,groundMaterial,cartGeometry,trackMaterial,padGeometry,tileGeometry,houseGeometry,canopyGeometry,
        wingGeometry,wingCanopyGeometry,capGeometry,windowGeometry,windowMullion,doorGeometry,jambGeometry,stepGeometry,
        tileSeamGeometry,roofRibGeometry,sillGeometry,ledgeGeometry,shrubGeometry,antennaGeometry,beaconGeometry,
        neutral,light,metal,baseMaterial,foliage,ringGeometry,flareGeometry,fxGeometry,clockPaving,clockBase,clockCornice,
        clockTower,clockRoof,clockDial,clockBezel,clockTick,clockHand,clockHandle,clockPost,clockBrick])resource.dispose();
      sun.shadow.dispose();renderer.dispose();redraw.current=()=>{};move.current=()=>{};
    };
  },[]);

  const controls:[Move,string,string][]=[["home","⌂","全景"],["left","↶","左转"],["right","↷","右转"],["in","+","拉近"],["out","−","拉远"]];
  return <div ref={stage} className="hall-world" data-scene={state} aria-label="3D 任务大厅地图">
    <canvas ref={canvas} className="hall-world-canvas" tabIndex={state==="ready"?0:-1}
      aria-label="3D 视角：拖动或方向键旋转，滚轮或加减键缩放，Home 恢复全景"/>
    {state!=="ready"&&<span className="hall-world-notice" role="status">{state==="loading"?"正在加载 3D 地图…":"简洁地图 · 可点击工作站"}</span>}
    <div className="hall-world-labels" hidden={!showLabels&&state==="ready"}>
      {stations.map(item=>{
        const count=stationCounts[item.id]??0;
        const active=activeStation===item.id,mode=activity.current.get(item.id)?.state??"sleeping";
        const usage=item.kind==="core" ? "" : item.usageCount==null ? " · 使用量暂无记录" : " · "+item.usageCount+" 条会话";
        return <button key={item.id} type="button" ref={node=>{if(node)labels.current.set(item.id,node);else labels.current.delete(item.id);}}
          className="hall-world-label" style={{"--hall-station":item.color,"--hall-size":item.scale} as React.CSSProperties}
          data-station-kind={item.kind} data-station-id={item.id} data-station-scale={item.scale.toFixed(3)}
          data-state={mode} title={item.name+" · "+STATE_LABEL[mode]+usage}
          aria-label={item.name+"，"+STATE_LABEL[mode]} aria-pressed={active} data-occupied={mode==="running"||undefined} onClick={()=>onStation(item.id)}>
          <i aria-hidden="true"/><span>{item.name}</span>{count>0&&<small>{count}</small>}
        </button>;
      })}
    </div>
    {state==="ready"&&<div className="hall-world-hud">
      <div className="hall-world-legend" aria-label="建筑状态图例">
        {(["running","completed","sleeping"] as const).map(status=><span data-state={status} key={status}><i aria-hidden="true"/>{STATE_LABEL[status]}</span>)}
      </div>
      <span className="hall-world-help">拖动旋转 · 滚轮缩放</span>
    </div>}
    <div className="hall-world-controls" aria-label="地图视角">
      {controls.map(([kind,icon,label])=><button key={kind} type="button" disabled={state!=="ready"} onClick={()=>move.current(kind)} aria-label={label}><b aria-hidden="true">{icon}</b><span>{label}</span></button>)}
      <button type="button" disabled={state!=="ready"} aria-pressed={showLabels} onClick={()=>setShowLabels(x=>!x)} aria-label="切换工作站名牌"><b aria-hidden="true">◇</b><span>名牌</span></button>
    </div>
  </div>;
}
