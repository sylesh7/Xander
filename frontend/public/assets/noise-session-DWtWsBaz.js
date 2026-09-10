import{textmode as e}from"./textmode.esm-DyldeNnf.js";var t=`#version 300 es
precision highp float;

in vec2 v_uv;

uniform sampler2D u_previousState;
uniform float u_time;
uniform vec2 u_seed;
uniform float u_delta;
uniform float u_aspect;
uniform vec2 u_gridSize;
uniform vec2 u_pointer;
uniform vec2 u_pointerVelocity;
uniform float u_pointerActivity;

out vec4 fragColor;

const float TAU = 6.28318530718;
const float VELOCITY_RANGE = 0.75;

float hash21(vec2 value) {
  value = fract(value * vec2(123.34, 456.21));
  value += dot(value, value + 45.32);
  return fract(value.x * value.y);
}

float valueNoise(vec2 position) {
  vec2 cell = floor(position);
  vec2 local = fract(position);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

vec2 toFramebufferUV(vec2 visualUV) {
  return vec2(visualUV.x, 1.0 - visualUV.y);
}

vec4 readStateTexel(vec2 visualUV) {
  vec2 texel = 1.0 / max(u_gridSize, vec2(1.0));
  vec2 boundedUV = clamp(visualUV, texel * 0.5, vec2(1.0) - texel * 0.5);
  return texture(u_previousState, toFramebufferUV(boundedUV));
}

vec4 sampleState(vec2 visualUV) {
  vec2 size = max(u_gridSize, vec2(1.0));
  vec2 position = clamp(visualUV, vec2(0.0), vec2(1.0)) * size - 0.5;
  vec2 base = floor(position);
  vec2 blend = fract(position);
  vec2 uv00 = (base + 0.5) / size;
  vec2 uv10 = (base + vec2(1.5, 0.5)) / size;
  vec2 uv01 = (base + vec2(0.5, 1.5)) / size;
  vec2 uv11 = (base + 1.5) / size;
  vec4 top = mix(readStateTexel(uv00), readStateTexel(uv10), blend.x);
  vec4 bottom = mix(readStateTexel(uv01), readStateTexel(uv11), blend.x);
  return mix(top, bottom, blend.y);
}

vec2 decodeVelocity(vec4 state) {
  return (state.rg * 2.0 - 1.0) * VELOCITY_RANGE;
}

vec2 encodeVelocity(vec2 velocity) {
  return clamp(velocity / VELOCITY_RANGE * 0.5 + 0.5, 0.0, 1.0);
}

void main() {
  vec2 texel = 1.0 / max(u_gridSize, vec2(1.0));
  vec2 velocity = decodeVelocity(sampleState(v_uv));
  vec2 backtracedUV = v_uv - velocity * u_delta * 0.46;
  vec4 advected = sampleState(backtracedUV);
  velocity = decodeVelocity(advected);

  vec2 velocityLeft = decodeVelocity(sampleState(v_uv - vec2(texel.x, 0.0)));
  vec2 velocityRight = decodeVelocity(sampleState(v_uv + vec2(texel.x, 0.0)));
  vec2 velocityUp = decodeVelocity(sampleState(v_uv - vec2(0.0, texel.y)));
  vec2 velocityDown = decodeVelocity(sampleState(v_uv + vec2(0.0, texel.y)));
  vec2 neighborAverage = (velocityLeft + velocityRight + velocityUp + velocityDown) * 0.25;
  float curl = (velocityRight.y - velocityLeft.y - velocityDown.x + velocityUp.x) * 0.5;
  velocity = mix(velocity, neighborAverage, 0.075);
  velocity += vec2(-velocity.y, velocity.x) * curl * u_delta * 0.28;

  vec2 seedOffset = u_seed * vec2(97.31, 53.77);
  vec2 temporalOffset = vec2(
    sin(u_time * 0.13 + u_seed.x * TAU),
    cos(u_time * 0.11 + u_seed.y * TAU)
  ) * 0.42;
  vec2 noisePosition = v_uv * vec2(3.1 * u_aspect, 3.1) + seedOffset + temporalOffset + vec2(u_time * 0.057, -u_time * 0.046);
  float primaryAngle = valueNoise(noisePosition) * TAU;
  float secondaryAngle = valueNoise(noisePosition * 1.87 + vec2(-u_time * 0.093, u_time * 0.071) + vec2(11.3, 27.1)) * TAU;
  vec2 primaryForce = vec2(cos(primaryAngle), sin(primaryAngle));
  vec2 secondaryForce = vec2(cos(secondaryAngle), sin(secondaryAngle));
  vec2 noiseForce = normalize(mix(primaryForce, secondaryForce, 0.38) + vec2(0.0001));
  velocity += noiseForce * u_delta * 0.46;

  vec2 pointerDelta = (v_uv - u_pointer) * vec2(u_aspect, 1.0);
  float pointerDistanceSquared = dot(pointerDelta, pointerDelta);
  float pointerInfluence = exp(-pointerDistanceSquared * 72.0) * u_pointerActivity;
  float pointerDyeCore = exp(-pointerDistanceSquared * 190.0) * u_pointerActivity;
  float pointerSpeed = length(u_pointerVelocity);
  vec2 pointerDirection = pointerSpeed > 0.0001 ? u_pointerVelocity / pointerSpeed : vec2(1.0, 0.0);
  vec2 pointerTangent = vec2(-pointerDirection.y, pointerDirection.x);
  velocity += u_pointerVelocity * pointerInfluence * 0.48;
  velocity += pointerTangent * pointerInfluence * min(pointerSpeed, 1.5) * 0.10;

  float edge = min(
    min(smoothstep(0.0, texel.x * 2.0, v_uv.x), smoothstep(0.0, texel.x * 2.0, 1.0 - v_uv.x)),
    min(smoothstep(0.0, texel.y * 2.0, v_uv.y), smoothstep(0.0, texel.y * 2.0, 1.0 - v_uv.y))
  );
  velocity *= exp(-u_delta * 0.85) * edge;

  float sourceNoiseA = valueNoise(noisePosition * 1.63 + vec2(13.7, 4.9));
  float sourceNoiseB = valueNoise(noisePosition.yx * 2.07 + vec2(u_time * 0.121, -u_time * 0.097) + vec2(5.2, 31.8));
  float densitySource = smoothstep(0.58, 0.88, mix(sourceNoiseA, sourceNoiseB, 0.42)) * 0.31;
  float density = mix(advected.b * exp(-u_delta * 0.31), densitySource, 1.0 - exp(-u_delta * 1.65));
  density = clamp(density + pointerInfluence * 0.22, 0.0, 1.0);

  float pointerDye = advected.a * exp(-u_delta * 1.45);
  float dyeSpeed = smoothstep(0.025, 0.50, pointerSpeed);
  float dyeInjectionRate = pointerDyeCore * mix(2.8, 7.2, dyeSpeed);
  pointerDye = 1.0 - (1.0 - pointerDye) * exp(-u_delta * dyeInjectionRate);
  pointerDye = clamp(pointerDye, 0.0, 1.0);

  fragColor = vec4(encodeVelocity(velocity), density, pointerDye);
}
`,n=`#version 300 es
precision highp float;

in vec2 v_uv;

uniform float u_time;
uniform vec2 u_seed;
uniform float u_aspect;
uniform float u_motionEnabled;
uniform sampler2D u_fluidState;
uniform vec2 u_pointer;
uniform float u_pointerActivity;
uniform vec2 u_symbolGlyphs[10];
uniform vec3 u_background;
uniform vec3 u_neutralLow;
uniform vec3 u_neutralHigh;
uniform vec3 u_signal;

layout(location = 0) out vec4 o_character;
layout(location = 1) out vec4 o_primaryColor;
layout(location = 2) out vec4 o_secondaryColor;

const float TAU = 6.28318530718;

float hash21(vec2 value) {
  value = fract(value * vec2(123.34, 456.21));
  value += dot(value, value + 45.32);
  return fract(value.x * value.y);
}

float valueNoise(vec2 position) {
  vec2 cell = floor(position);
  vec2 local = fract(position);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

float fbm3(vec2 position) {
  const mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
  float value = 0.0;
  float amplitude = 0.56;
  value += amplitude * valueNoise(position);
  position = rotation * position * 2.03 + vec2(17.1, 9.2);
  amplitude *= 0.52;
  value += amplitude * valueNoise(position);
  position = rotation * position * 2.01 + vec2(8.3, 21.7);
  amplitude *= 0.52;
  value += amplitude * valueNoise(position);
  return value / 0.997;
}

vec4 sampleFluid(vec2 visualUV) {
  return texture(u_fluidState, vec2(visualUV.x, 1.0 - visualUV.y));
}

void main() {
  vec4 fluid = sampleFluid(v_uv);
  vec2 fluidVelocity = (fluid.rg * 2.0 - 1.0) * 0.75 * u_motionEnabled;
  vec2 seedOffset = u_seed * vec2(83.17, 61.73);
  vec2 position = (v_uv - 0.5) * vec2(u_aspect, 1.0) + seedOffset;
  position -= fluidVelocity * 0.19;

  float temporalPhase = u_time * 0.17 + u_seed.x * TAU;
  vec2 temporalDeformation = vec2(
    sin(position.y * 2.10 + temporalPhase) + 0.52 * sin(position.x * 1.23 - temporalPhase * 0.73),
    cos(position.x * 1.82 - temporalPhase * 0.91) + 0.48 * cos(position.y * 1.37 + temporalPhase * 0.61)
  ) * 0.085;
  position += temporalDeformation;

  vec2 drift = vec2(u_time * 0.084, -u_time * 0.061);
  float warpPulse = 0.98 + 0.16 * sin(u_time * 0.21 + u_seed.y * TAU);
  vec2 warp = vec2(
    fbm3(position * 1.30 + drift + fluidVelocity * 0.22),
    fbm3(position * 1.30 - drift + vec2(7.2, 3.8) - fluidVelocity * 0.18)
  );
  float field = fbm3(position * 1.82 + (warp - 0.5) * 1.10 * warpPulse + drift * 0.72);
  float detail = valueNoise(position * 5.6 - drift * 1.65 + warp * 0.85 + temporalDeformation * 2.4);
  float flowEnergy = clamp(length(fluidVelocity) * 0.34 + fluid.b * 0.72 * u_motionEnabled, 0.0, 1.0);
  float density = smoothstep(0.18, 0.91, field * 0.66 + detail * 0.16 + flowEnergy * 0.26);

  int symbolIndex = min(9, int(floor(clamp(density, 0.0, 0.9999) * 10.0)));
  vec2 glyph = u_symbolGlyphs[symbolIndex];

  float ambientAccentField = fbm3(
    position * 1.46 + (warp - 0.5) * 1.58 - drift * 0.55 + vec2(23.7, 41.3)
  );
  float ambientRidge = 1.0 - smoothstep(0.018, 0.065, abs(ambientAccentField - 0.58));
  float ambientDensityGate = smoothstep(0.46, 0.76, density) * smoothstep(0.32, 0.62, field);
  float ambientAccent = ambientRidge * ambientDensityGate * 0.54;

  vec2 pointerOffset = (v_uv - u_pointer) * vec2(u_aspect, 1.0);
  float pointerAnchor = exp(-dot(pointerOffset, pointerOffset) * 210.0) * u_pointerActivity;
  float transportedDye = smoothstep(0.018, 0.72, fluid.a) * u_motionEnabled;
  float redMask = clamp(ambientAccent + transportedDye * 0.84 + pointerAnchor * 0.92, 0.0, 1.0);
  vec3 neutral = mix(u_neutralLow, u_neutralHigh, clamp(density * 0.78 + detail * 0.14, 0.0, 1.0));
  vec3 glyphColor = mix(neutral, u_signal, smoothstep(0.02, 0.82, redMask));

  o_character = vec4(glyph, 0.0, 0.0);
  o_primaryColor = vec4(glyphColor, 1.0);
  o_secondaryColor = vec4(u_background, 1.0);
}
`,r=1.5,i=12,a=10,o=11,s=(e,t,n)=>Math.min(n,Math.max(t,e)),c=(e,t)=>1-Math.exp(-e*t),l=class{state={activity:0,position:[.5,.5],velocity:[0,0]};target=[.5,.5];eventVelocity=[0,0];lastEventPosition=[.5,.5];hasEventPosition=!1;impulse=0;lastEventTime=0;lastMoveTime=-1/0;sample(e,t){let[n,i]=e.position;if(this.target[0]=n,this.target[1]=i,e.inside&&this.hasEventPosition){let t=s((e.time-this.lastEventTime)/1e3,1/240,.1),a=(n-this.lastEventPosition[0])/t,o=(i-this.lastEventPosition[1])/t,c=Math.hypot(a,o),l=c>r?r/c:1;a*=l,o*=l,this.eventVelocity[0]=a,this.eventVelocity[1]=o,this.impulse=s(c/.9,0,1),this.lastMoveTime=e.time}else e.inside||(this.impulse=0);this.lastEventPosition[0]=n,this.lastEventPosition[1]=i,this.lastEventTime=e.time,this.hasEventPosition=e.inside,t&&e.inside&&(this.state.position[0]=n,this.state.position[1]=i,this.state.velocity[0]=this.eventVelocity[0]*.08,this.state.velocity[1]=this.eventVelocity[1]*.08,this.state.activity=this.impulse*.14)}update(e,t){let n=Math.max(0,(t-this.lastMoveTime)/1e3),r=Math.exp(-6.5*n),s=this.impulse*Math.exp(-4.2*n),l=c(i,e),u=c(a,e),d=c(o,e);this.state.position[0]+=(this.target[0]-this.state.position[0])*l,this.state.position[1]+=(this.target[1]-this.state.position[1])*l,this.state.velocity[0]+=(this.eventVelocity[0]*r-this.state.velocity[0])*u,this.state.velocity[1]+=(this.eventVelocity[1]*r-this.state.velocity[1])*u,this.state.activity+=(s-this.state.activity)*d}pause(){this.eventVelocity[0]=0,this.eventVelocity[1]=0,this.state.velocity[0]=0,this.state.velocity[1]=0,this.state.activity=0,this.impulse=0,this.hasEventPosition=!1}},u=` .:-=+*#%@`,d=.05,f=(e,t,n)=>[e/255,t/255,n/255],p={dark:{background:f(10,10,10),neutralLow:f(41,41,39),neutralHigh:f(90,90,86),signal:f(177,18,38)},light:{background:f(242,242,236),neutralLow:f(216,216,210),neutralHigh:f(154,154,149),signal:f(177,18,38)}},m=()=>{if(typeof globalThis.crypto?.getRandomValues==`function`){let e=new Uint32Array(2);return globalThis.crypto.getRandomValues(e),[e[0]/4294967295,e[1]/4294967295]}return[Math.random(),Math.random()]},h=e=>e instanceof Error?e.message:String(e),g=e=>{if(!e.grid)throw Error(`textmode.js did not initialize its responsive grid.`);return e.grid},_=e=>Array.from(u,t=>{let n=e.font.characterMap.get(t);if(!n)throw Error(`The default textmode.js tileset does not contain ${JSON.stringify(t)}.`);return[n.color[0],n.color[1]]});function v(r,i){let a=p[i],o=m(),s=new l,c=r.size,u=null,f=null,v=null,y=null,b=null,x=0,S=0,C=!1,w=!1,T=!1,E=!1,D=!1,O=e.create({canvas:r.canvas,width:c.width,height:c.height,overlay:!1,pixelDensity:1,fontSize:16,frameRate:60,loadingScreen:{transition:`none`}});O.canvas.classList.add(`textmode-noise__canvas`),O.canvas.setAttribute(`aria-hidden`,`true`),O.canvas.style.pointerEvents=`none`,O.targetFrameRate(60);let k=e=>{e.begin();try{O.background(128,128,0,0)}finally{e.end()}},A=e=>{let t=e.textures[0];if(!t)throw Error(`The fluid feedback texture is unavailable.`);return t},j=e=>{if(v){for(let t of v)(t.width!==e.cols||t.height!==e.rows)&&t.resize(e.cols,e.rows),k(t);x=0}},M=e=>{T||(O.noLoop(),D||(D=!0,console.error(`[textmode-noise] Background stopped: ${h(e)}`)),r.markFallback())},N=r.subscribePointer(e=>{s.sample(e,!C),!C&&w&&!E&&(E=!0,O.redraw())});O.setup(async()=>{try{let e=g(O),i=_(O);if([u,f]=await Promise.all([O.createMaterialShader(n),O.createMaterialShader(t)]),T)return;v=[O.createFramebuffer({width:e.cols,height:e.rows,attachments:1}),O.createFramebuffer({width:e.cols,height:e.rows,attachments:1})],k(v[0]),k(v[1]);let l=A(v[0]),d=c.width/Math.max(c.height,1);y={u_time:0,u_seed:o,u_aspect:d,u_motionEnabled:0,u_fluidState:l,u_pointer:s.state.position,u_pointerActivity:0,u_symbolGlyphs:i,u_background:a.background,u_neutralLow:a.neutralLow,u_neutralHigh:a.neutralHigh,u_signal:a.signal},b={u_previousState:l,u_time:0,u_seed:o,u_delta:0,u_aspect:d,u_gridSize:[e.cols,e.rows],u_pointer:s.state.position,u_pointerVelocity:s.state.velocity,u_pointerActivity:0},w=!0,r.markReady()}catch(e){M(e)}}),O.draw(()=>{if(E=!1,!(T||!w))try{if(!u||!f||!v||!y||!b)return;let e=g(O),t=Math.min(d,Math.max(0,O.deltaTime()/1e3));C&&(S+=t,s.update(t,r.now()));let n=c.width/Math.max(c.height,1);if(y.u_time=S,y.u_aspect=n,y.u_motionEnabled=+!!C,y.u_pointerActivity=s.state.activity,C){let r=+(x===0),i=v[x],a=v[r];b.u_previousState=A(i),b.u_time=S,b.u_delta=t,b.u_aspect=n,b.u_gridSize[0]=e.cols,b.u_gridSize[1]=e.rows,b.u_pointerActivity=s.state.activity,a.begin();try{O.clear(),O.shader(f),O.setUniforms(b),O.rect(e.cols,e.rows)}finally{a.end()}x=r}y.u_fluidState=A(v[x]),O.shader(u),O.setUniforms(y),O.rect(e.cols,e.rows),r.markPresented()}catch(e){M(e)}});let P=!1;return{destroy:()=>{T||(T=!0,P||(P=!0,N()),O.destroy())},redraw:()=>{T||O.redraw()},resize:e=>{T||(c=e,O.resizeCanvas(e.width,e.height),w&&j(g(O)))},setRunning:e=>{T||(C=e,C?O.loop():(s.pause(),O.noLoop(),w&&O.redraw()))},update:()=>void 0}}export{d as MAX_DELTA_SECONDS,p as NOISE_PALETTES,u as SYMBOL_CHARACTERS,v as createTextmodeNoiseSession};