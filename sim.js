// ===== utils =====
const qs = s => document.querySelector(s);
const clamp = (x, lo=0, hi=1) => Math.max(lo, Math.min(hi, x));
const lerp = (a,b,t)=>a+(b-a)*t;
const randN = () => { // ~N(0,1)
  let u=0,v=0; while(u===0) u=Math.random(); while(v===0) v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
};
const hslToHex = (h,s,l)=>{
  const a = s*Math.min(l,1-l);
  const f = n=>{
    const k=(n+h*12)%12;
    const c=l-a*Math.max(-1,Math.min(k-3,Math.min(9-k,1)));
    return Math.round(255*c).toString(16).padStart(2,'0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};
const hexToHsl = (hex)=>{
  const c = hex.replace('#','');
  const r = parseInt(c.slice(0,2),16)/255;
  const g = parseInt(c.slice(2,4),16)/255;
  const b = parseInt(c.slice(4,6),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h,s,l=(max+min)/2;
  if(max===min){h=s=0;} else {
    const d=max-min;
    s = l>0.5? d/(2-max-min): d/(max+min);
    switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;case b:h=(r-g)/d+4;}
    h/=6;
  }
  return {h,s,l};
};

// ===== state =====
const world = qs('#world'), wctx = world.getContext('2d');
const chart = qs('#chart'), cctx = chart.getContext('2d');
const tooltip = qs('#tooltip'), banner = qs('#banner');

const state = {
  running:false, timer:null, gen:0, pop:[], popSize:120,
  mutation:0.04, heritability:0.6, tick:900,
  envHue:220/360, envSat:0.4, envLum:0.20,
  predation:0.5, food:0.7, selection:0.6,
  consider:{size:true, speed:true, color:true},
  costs:{size:true},
  history:[],
  mono:false,
  hoverIndex:-1
};

// ===== bindings =====
const bindRange=(id, key, fmt=x=>x)=>{
  const el=qs(id), lbl=qs(`#lbl${el.id.charAt(0).toUpperCase()+el.id.slice(1)}`) || null;
  const set=v=>{
    let val = (el.step && el.step.includes('.'))? parseFloat(v) : (el.id==='tick'?parseInt(v):parseFloat(v));
    state[key]=val; if(lbl) lbl.textContent = (el.id==='tick'? val: fmt(val));
    if(id==='#tick' && state.running){ stop(); start(); }
  };
  set(el.value);
  el.addEventListener('input', e=>set(e.target.value));
};
bindRange('#popSize','popSize', v=>parseInt(v));
bindRange('#mutation','mutation', v=>parseInt(v));
bindRange('#heritability','heritability', v=>(+v).toFixed(2));
bindRange('#tick','tick', v=>parseInt(v));
bindRange('#predation','predation', v=>(+v).toFixed(2));
bindRange('#food','food', v=>(+v).toFixed(2));
bindRange('#selection','selection', v=>(+v).toFixed(2));

const envColor = qs('#envColor');
const setEnvFromHex = (hex)=>{
  const {h,s,l}=hexToHsl(hex);
  state.envHue=h; state.envSat=s; state.envLum=l;
  draw();
};
setEnvFromHex(envColor.value);
envColor.addEventListener('input', e=>setEnvFromHex(e.target.value));

['#traitSize','#traitSpeed','#traitColor','#costSize'].forEach(id=>{
  qs(id).addEventListener('change', ()=>{
    state.consider.size = qs('#traitSize').checked;
    state.consider.speed= qs('#traitSpeed').checked;
    state.consider.color= qs('#traitColor').checked;
    state.costs.size    = qs('#costSize').checked;
    draw();
  });
});
qs('#mono').addEventListener('change', e=>{ state.mono=e.target.checked; draw(); });

// buttons
qs('#playPause').addEventListener('click', ()=> state.running? stop(): start());
qs('#stepGen').addEventListener('click', ()=>{ stop(); loopOnce(); });
qs('#resetBtn').addEventListener('click', ()=>{ stop(); initPopulation(state.popSize); });

document.querySelectorAll('[data-shock]').forEach(btn=>{
  btn.addEventListener('click', ()=> shock(btn.dataset.shock));
});

// ===== resize =====
function resize(){
  const dpr=Math.max(1, window.devicePixelRatio||1);
  const ww = world.clientWidth, wh = world.clientHeight;
  world.width=Math.floor(ww*dpr); world.height=Math.floor(wh*dpr);
  wctx.setTransform(dpr,0,0,dpr,0,0);
  const cw = chart.clientWidth, ch = chart.clientHeight;
  chart.width=Math.floor(cw*dpr); chart.height=Math.floor(ch*dpr);
  cctx.setTransform(dpr,0,0,dpr,0,0);
  draw(); drawChart();
}
window.addEventListener('resize', resize);

// ===== model =====
class Critter{
  constructor({size,speed,colorHue}={}){
    this.size = clamp(0.5 + 0.25*randN());
    this.speed= clamp(0.5 + 0.25*randN());
    this.colorHue = clamp(state.envHue + 0.2*randN());
    if(size !== undefined) this.size = clamp(size);
    if(speed!== undefined) this.speed= clamp(speed);
    if(colorHue!==undefined) this.colorHue=clamp(colorHue);
    this.x=Math.random(); this.y=Math.random();
    this.vx=(Math.random()*2-1)*0.002*(0.5+this.speed);
    this.vy=(Math.random()*2-1)*0.002*(0.5+this.speed);
  }
  step(){
    this.x=clamp(this.x+this.vx,0,1);
    this.y=clamp(this.y+this.vy,0,1);
    if(this.x<=0||this.x>=1) this.vx*=-1;
    if(this.y<=0||this.y>=1) this.vy*=-1;
  }
}
function initPopulation(n){
  state.pop = Array.from({length:n}, ()=> new Critter({}));
  state.gen=0; state.history=[]; pushHistory();
  draw(); drawChart();
}
function inherit(val){
  const h=state.heritability;
  return clamp( h*val + (1-h)*(0.5 + 0.25*randN()) );
}
function mutate(val, scale=0.12){
  if(Math.random()< state.mutation/100) return clamp(val + randN()*scale);
  return val;
}
function fitness(cr){
  let f=1.0;
  if(state.consider.size){
    const prot = lerp(0.8, 1.25, cr.size);
    f *= lerp(1.0, prot, state.predation);
    if(state.costs.size){
      const cost = lerp(1.0, 0.7, cr.size);
      const adj = lerp(1.0, cost, 1.0 - state.food);
      f *= adj;
    }
  }
  if(state.consider.speed){
    const run = lerp(0.85, 1.3, cr.speed);
    f *= lerp(1.0, run, state.predation);
  }
  if(state.consider.color){
    const dh = Math.min(Math.abs(cr.colorHue - state.envHue), 1 - Math.abs(cr.colorHue - state.envHue));
    const camo = lerp(1.3, 0.7, clamp(dh*4));
    f *= camo;
  }
  return Math.max(0.001, Math.pow(f, 0.5 + state.selection));
}
function nextGeneration(){
  const pop=state.pop, fit=pop.map(fitness);
  const total = fit.reduce((a,b)=>a+b,0);
  const probs = fit.map(f=>f/total);
  const survRate = clamp( (fit.filter(x=>x>1).length / fit.length), 0, 1);
  const newPop=[];
  for(let i=0;i<state.popSize;i++){
    const idx = sampleIndex(probs), p = pop[idx];
    const child = new Critter({
      size: mutate(inherit(p.size)),
      speed: mutate(inherit(p.speed)),
      colorHue: clamp(mutate(inherit(p.colorHue), 0.06))
    });
    newPop.push(child);
  }
  state.pop=newPop; state.gen++;
  pushHistory(survRate);
}
function sampleIndex(prob){
  let r=Math.random(), s=0;
  for(let i=0;i<prob.length;i++){ s+=prob[i]; if(r<=s) return i; }
  return prob.length-1;
}

// ===== draw =====
function worldBg(){
  const h=state.envHue, s=state.envSat, l=state.envLum;
  wctx.fillStyle = `hsl(${(h*360).toFixed(1)} ${Math.round(s*100)}% ${Math.round(l*100)}%)`;
  wctx.fillRect(0,0,world.clientWidth,world.clientHeight);
}
function drawCritter(cr){
  const W=world.clientWidth, H=world.clientHeight;
  const x=cr.x*W, y=cr.y*H;

  // derive readable cues
  const r = lerp(4, 12, cr.size);                // radius proxy for size
  const lineW = lerp(1, 3.5, cr.size);           // stroke width = size
  const tail = lerp(6, 26, cr.speed);            // tail length = speed
  const dh = Math.min(Math.abs(cr.colorHue - state.envHue), 1 - Math.abs(cr.colorHue - state.envHue));
  const camoScore = 1 - clamp(dh*4);             // 0..1 (1 = godt kamuflert)
  const fit = fitness(cr);
  const dom = dominantTrait(cr, camoScore);      // "size" | "speed" | "camo"

  // colors/monochrome
  const fillHue = state.mono ? 0 : (state.envHue*360*(0.7) + cr.colorHue*360*0.3);
  const sat = state.mono ? 0 : 50;
  const baseLum = state.mono ? 70 : 50;
  const lum = state.mono ? 70 : lerp(baseLum-15, baseLum+15, 1-camoScore); // dårligere camo => mer kontrast
  const stroke = `rgba(209,213,219,0.9)`;
  const fill = state.mono ? `hsl(0 0% ${lum}%)` : `hsl(${fillHue.toFixed(0)} ${sat}% ${lum}%)`;

  // tail (speed)
  wctx.lineWidth = 2;
  wctx.strokeStyle = `rgba(148,163,184,0.65)`;
  wctx.beginPath();
  wctx.moveTo(x, y);
  // tail direction ~ velocity
  wctx.lineTo(x - Math.sign(cr.vx || 0.001)*tail, y - Math.sign(cr.vy || 0.001)*tail*0.35);
  wctx.stroke();

  // body outline
  wctx.lineWidth = lineW;
  wctx.strokeStyle = stroke;
  wctx.fillStyle = fill;

  // shape by dominant trait
  if(dom==='size'){ // circle
    wctx.beginPath(); wctx.arc(x,y,r,0,Math.PI*2); wctx.fill(); wctx.stroke();
  } else if(dom==='speed'){ // triangle
    drawTriangle(x,y,r); wctx.fill(); wctx.stroke();
  } else { // camo -> square with rounded corners
    drawSquare(x,y,r); wctx.fill(); wctx.stroke();
  }
}
function drawTriangle(x,y,r){
  const h = r*1.6;
  wctx.beginPath();
  wctx.moveTo(x, y - h/1.3);
  wctx.lineTo(x - r*1.1, y + h/2);
  wctx.lineTo(x + r*1.1, y + h/2);
  wctx.closePath();
}
function drawSquare(x,y,r){
  const s = r*1.7, rr = Math.max(2, r*0.6);
  const x0=x-s/2, y0=y-s/2, x1=x+s/2, y1=y+s/2;
  wctx.beginPath();
  wctx.moveTo(x0+rr,y0);
  wctx.lineTo(x1-rr,y0);
  wctx.quadraticCurveTo(x1,y0,x1,y0+rr);
  wctx.lineTo(x1,y1-rr);
  wctx.quadraticCurveTo(x1,y1,x1-rr,y1);
  wctx.lineTo(x0+rr,y1);
  wctx.quadraticCurveTo(x0,y1,x0,y1-rr);
  wctx.lineTo(x0,y0+rr);
  wctx.quadraticCurveTo(x0,y0,x0+rr,y0);
  wctx.closePath();
}
function dominantTrait(cr, camoScore){
  const a = cr.size, b = cr.speed, c = camoScore;
  if(a>=b && a>=c) return 'size';
  if(b>=a && b>=c) return 'speed';
  return 'camo';
}
function draw(){
  worldBg();
  const counts = {size:0, speed:0, camo:0};
  for(const cr of state.pop){
    cr.step();
    const dh = Math.min(Math.abs(cr.colorHue - state.envHue), 1 - Math.abs(cr.colorHue - state.envHue));
    const camoScore = 1 - clamp(dh*4);
    counts[dominantTrait(cr, camoScore)]++;
    drawCritter(cr);
  }
  qs('#countSize').textContent = counts.size;
  qs('#countSpeed').textContent= counts.speed;
  qs('#countCamo').textContent = counts.camo;
}

// ===== history / chart =====
function pushHistory(surv=1){
  const avg = a=>a.reduce((x,y)=>x+y,0)/a.length;
  const sd  = a=>Math.sqrt(avg(a.map(x=>(x-avg(a))**2)));
  const sizes=state.pop.map(p=>p.size);
  const speeds=state.pop.map(p=>p.speed);
  const camo = state.pop.map(p=>{
    const d = Math.min(Math.abs(p.colorHue - state.envHue), 1 - Math.abs(p.colorHue - state.envHue));
    return 1 - clamp(d*4);
  });
  state.history.push({
    gen:state.gen, surv:Math.round(surv*100),
    size:{mean:avg(sizes), sd:sd(sizes)},
    speed:{mean:avg(speeds), sd:sd(speeds)},
    camo:{mean:avg(camo), sd:sd(camo)}
  });
  qs('#kGen').textContent=state.gen;
  qs('#kSurv').textContent=state.history.at(-1).surv;
  qs('#kSize').textContent=state.history.at(-1).size.mean.toFixed(2);
  qs('#kSpeed').textContent=state.history.at(-1).speed.mean.toFixed(2);
  qs('#kCamo').textContent=state.history.at(-1).camo.mean.toFixed(2);
}
function drawChart(){
  const w=chart.clientWidth, h=chart.clientHeight;
  cctx.clearRect(0,0,w,h);
  if(state.history.length<2) return;
  cctx.lineWidth=1; cctx.strokeStyle='rgba(255,255,255,0.15)';
  cctx.beginPath(); cctx.moveTo(30,10); cctx.lineTo(30,h-20); cctx.lineTo(w-10,h-20); cctx.stroke();

  const gens=state.history.map(d=>d.gen);
  const s=state.history.map(d=>d.size.mean);
  const v=state.history.map(d=>d.speed.mean);
  const c=state.history.map(d=>d.camo.mean);

  const xmin=gens[0], xmax=gens.at(-1);
  const X = g=> lerp(30, w-10, (g-xmin)/Math.max(1,(xmax-xmin)));
  const Y = v=> lerp(h-20, 10, v);

  const line=(vals,color)=>{
    cctx.beginPath();
    vals.forEach((val,i)=>{
      const gx=X(gens[i]), gy=Y(val);
      if(i===0) cctx.moveTo(gx,gy); else cctx.lineTo(gx,gy);
    });
    cctx.strokeStyle=color; cctx.lineWidth=2; cctx.stroke();
  };
  line(s,'#ffd48a'); line(v,'#9bd1ff'); line(c,'#b6ffb3');
}

// ===== loop =====
function loopOnce(){ nextGeneration(); draw(); drawChart(); }
function start(){ if(state.running) return; state.running=true; qs('#playPause').textContent='Pause'; state.timer=setInterval(loopOnce, state.tick); }
function stop(){ state.running=false; qs('#playPause').textContent='Start'; clearInterval(state.timer); }

// ===== shocks & banner =====
function shock(type){
  let msg='';
  switch(type){
    case 'drought':
      state.food = Math.max(0.2, state.food - 0.4);
      qs('#lblFood').textContent=state.food.toFixed(2); qs('#food').value=state.food;
      msg='Tørke: Mindre mat, store kropper blir dyrere.';
      break;
    case 'newPred':
      state.predation = clamp(state.predation + 0.3, 0, 1);
      qs('#lblPred').textContent=state.predation.toFixed(2); qs('#predation').value=state.predation;
      msg='Ny predator: Hastighet og/eller størrelse hjelper.';
      break;
    case 'colorShift':
      state.envHue=(state.envHue+1/3)%1; envColor.value=hslToHex(state.envHue,state.envSat,state.envLum);
      msg='Habitatet skifter farge: Kamuflasje endrer seg!';
      break;
    case 'coldSnap':
      state.selection=clamp(state.selection+0.2,0,1); qs('#selection').value=state.selection; qs('#lblSel').textContent=state.selection.toFixed(2);
      state.predation=clamp(state.predation+0.1,0,1); qs('#predation').value=state.predation; qs('#lblPred').textContent=state.predation.toFixed(2);
      msg='Kaldt år: Store kropper får fordel (varmetap).';
      break;
    case 'abundance':
      state.food=clamp(state.food+0.4,0,1); qs('#food').value=state.food; qs('#lblFood').textContent=state.food.toFixed(2);
      msg='Rikelig med mat: Energi-kostnaden betyr mindre.';
      break;
  }
  banner.textContent=msg;
  banner.style.opacity=1;
  setTimeout(()=>banner.style.opacity=0, 2200);
  draw();
}

// ===== hover inspector =====
function setupHover(){
  world.addEventListener('mousemove', e=>{
    const rect=world.getBoundingClientRect();
    const x=(e.clientX-rect.left)/rect.width;
    const y=(e.clientY-rect.top)/rect.height;
    const idx = nearestIndex(x,y);
    state.hoverIndex = idx;
    if(idx<0){ tooltip.style.display='none'; return; }
    const cr = state.pop[idx];
    const fit = fitness(cr);
    const dh = Math.min(Math.abs(cr.colorHue - state.envHue), 1 - Math.abs(cr.colorHue - state.envHue));
    const camoScore = (1 - clamp(dh*4));
    const dom = dominantTrait(cr, camoScore);

    tooltip.innerHTML = `
      <div class="row"><strong>Individ</strong>&nbsp;&middot;&nbsp;dom: ${dom}</div>
      <div class="row">Størrelse:&nbsp;<b>${cr.size.toFixed(2)}</b></div>
      <div class="row">Hastighet:&nbsp;<b>${cr.speed.toFixed(2)}</b></div>
      <div class="row">Kamuflasje:&nbsp;<b>${camoScore.toFixed(2)}</b></div>
      <div class="row">Fitness:</div>
      <div class="bar-demo"><span class="bar-fill" style="width:${clamp(fit/1.6,0,1)*100}%"></span></div>
    `;
    tooltip.style.left = `${e.clientX+12}px`;
    tooltip.style.top  = `${e.clientY+12}px`;
    tooltip.style.display='block';
  });
  world.addEventListener('mouseleave', ()=>{
    state.hoverIndex=-1; tooltip.style.display='none';
  });
}
function nearestIndex(x,y){
  let best=-1, bestD=1e9;
  for(let i=0;i<state.pop.length;i++){
    const dx=state.pop[i].x-x, dy=state.pop[i].y-y;
    const d=dx*dx+dy*dy;
    if(d<bestD){bestD=d; best=i;}
  }
  // radius threshold ~ 2.5% av diagonalen
  return (Math.sqrt(bestD)<0.05)? best: -1;
}

// ===== init =====
function boot(){
  resize();
  initPopulation(state.popSize);
  setupHover();
}
boot();
