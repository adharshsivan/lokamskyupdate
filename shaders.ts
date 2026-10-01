import type { QualitySettings } from './performance';

export const VERT = `attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}`;

// Single analytic pass: sky, sun, moon, stars, cloud layers, weather optics, ocean and rain.
// No ray marching and no textures. Weather features sit behind uniform branches (coherent, cheap).
const BODY = `
uniform vec4 uRW,uP0,uP1,uP2,uW0,uW1,uW2,uL0,uL1;
uniform vec3 uSun,uMoon,uSunCol,uZen,uHor,uFlashDir;
uniform mat3 uCam;

#define uRes uRW.xy
#define uWind uRW.zw
#define uTime uP0.x
#define uCloudT uP0.y
#define uSid uP0.z
#define uCamH uP0.w
#define uSunI uP1.x
#define uMoonI uP1.y
#define uStars uP1.z
#define uMoonLit uP1.w
#define uCover uP2.x
#define uWave uP2.y
#define uHaze uP2.z
#define uExp uP2.w
#define uOvercast uW0.x
#define uStorm uW0.y
#define uRain uW0.z
#define uShafts uW0.w
#define uFog uW1.x
#define uWindS uW1.y
#define uRainbow uW1.z
#define uSpray uW1.w
#define uFogbow uW2.x
#define uHalo uW2.y
#define uScud uW2.z
#define uGust uW2.w
#define uFlash uL0.x
#define uBolt uL0.y
#define uBoltSeed uL0.z
#define uBoltTop uL0.w
#define uBoltAz uL1.xy
#define uBoltW uL1.z
#define uLeader uL1.w

const vec3 MOONCOL=vec3(.32,.4,.58);
const vec3 FLASHCOL=vec3(.78,.84,1.);
const vec3 LUMA=vec3(.2126,.7152,.0722);
const float FOG_TOP=56.;
const float CLOUD_H=1500.;

float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);
}
// value noise that wraps in x with an integer period (seamless all the way around the horizon)
float pnoise(vec2 p,float per){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  float a=mod(i.x,per),b=mod(i.x+1.,per);
  return mix(mix(hash(vec2(a,i.y)),hash(vec2(b,i.y)),f.x),mix(hash(vec2(a,i.y+1.)),hash(vec2(b,i.y+1.)),f.x),f.y);
}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<CLOUD_OCT;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
float fade(float a,float b,float x){return 1.-smoothstep(a,b,x);}
vec3 hue(float h){return clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);}
float angTo(vec3 rd,vec3 d){return degrees(acos(clamp(dot(rd,d),-1.,1.)));}
// apparent sideways drift of falling rain for a horizontal view direction (+ = toward screen right)
float leanAt(vec2 dir){return -(uWind.x*dir.y-uWind.y*dir.x)*uWindS;}
float fogSigma(){return .004*uFog+.028*pow(uFog,1.6);}

// lightning light scattered inside the cloud deck: broad lobe + hot spot where the channel exits
vec3 flashL(vec3 rd){
  if(uFlash<.001) return vec3(0.);
  float d=max(dot(rd,uFlashDir),0.);
  return FLASHCOL*uFlash*(.08+pow(d,4.)*.8+pow(d,48.)*1.6);
}

vec3 skyBase(vec3 rd){
  float y=max(rd.y,0.);
  float h=pow(max(1.-y,0.),5.);
  vec3 c=mix(uZen,uHor,h);
  float sd=max(dot(rd,uSun),0.);
  float above=smoothstep(-.3,.05,uSun.y);
  // Mie aureole widens and brightens with aerosol haze
  float mie=pow(sd,6.)*.22+pow(sd,48.)*.45+pow(sd,600.)*1.5+uHaze*(pow(sd,3.)*.1+pow(sd,24.)*.35);
  c+=uSunCol*mie*uSunI*above*(.35+.65*h);
  vec2 a=normalize(rd.xz+1e-4),b=normalize(uSun.xz+1e-4);
  float az=max(dot(a,b),0.);
  c+=uSunCol*h*h*pow(az,3.)*.45*uSunI*smoothstep(-.28,.02,uSun.y)*fade(0.,.45,uSun.y);
  float md=max(dot(rd,uMoon),0.);
  c+=MOONCOL*pow(md,40.)*.05*uMoonI*uMoonLit*smoothstep(-.05,.1,uMoon.y);
  return c+flashL(rd)*.3;
}

// sea-fog colour: desaturated ambient with forward-scattered sun / moon glow
vec3 fogCol(vec3 rd){
  vec3 b=mix(uHor,uZen,.3);
  vec3 f=mix(b,vec3(dot(b,LUMA))*vec3(.96,1.,1.05),.6)*1.15;
  float sd=max(dot(rd,uSun),0.);
  f+=uSunCol*uSunI*(pow(sd,6.)*.35+pow(sd,40.)*.6)*smoothstep(-.12,.04,uSun.y);
  float md=max(dot(rd,uMoon),0.);
  f+=MOONCOL*uMoonI*uMoonLit*pow(md,12.)*.1*smoothstep(-.05,.1,uMoon.y);
  return f+flashL(rd)*.6;
}

// shared horizon/haze colour: sky, clouds and ocean all fade into exactly this (no seam)
vec3 horizonHaze(vec3 rd){
  vec3 h=skyBase(normalize(vec3(rd.x,.001,rd.z)));
  if(uFog>.001) h=mix(h,fogCol(rd),min(uFog*1.3,1.));
  return h;
}

// optical depth through a patchy, drifting sea-fog layer FOG_TOP thick (camera inside it)
float fogOD(vec3 rd,float t){
  float len=rd.y>=0.?min(FOG_TOP/max(rd.y,.0015),40000.):t;
  vec2 dr=uWind*uCloudT;
  float pch=.45+1.1*noise(rd.xz*min(len,700.)*.0045+dr*.25+3.7);
#ifdef FOG_DETAIL
  pch*=.78+.44*noise(rd.xz*18.+vec2(rd.y*9.,0.)+dr*3.);
#endif
  return fogSigma()*pch*len;
}

// layered clouds, composited front to back: scud, cumulus, stratus deck, cirrus
vec4 clouds(vec3 rd,out float thin){
  thin=0.;
  if(rd.y<.005) return vec4(0.);
  vec2 uv=rd.xz/(rd.y+.09)*.55;
  vec2 w=uWind*uCloudT;
  vec3 amb=mix(uHor,uZen,.55)*1.1;
  float dayL=uSunI*smoothstep(-.2,.02,uSun.y);
  float moonL=uMoonI*uMoonLit*smoothstep(-.05,.15,uMoon.y);
  vec3 fl=flashL(rd);
  vec3 acc=vec3(0.);
  float a=0.;
#ifdef STORM_DETAIL
  // scud / fractus: ragged, dark low cloud racing beneath the deck in rain and storms
  if(uScud>.01){
    vec2 su=rd.xz/(rd.y+.03)*1.1+w*2.4;
    float sn=noise(su*.7)*.55+noise(su*1.9+vec2(3.1,1.7))*.3+noise(su*4.3)*.15;
    float sa=smoothstep(.5,.8,sn)*uScud*smoothstep(.015,.1,rd.y)*.85;
    vec3 sc=amb*.6+uSunCol*dayL*.16+MOONCOL*moonL*.05+fl*(1.25-sa);
    acc=sc*sa;
    a=sa;
  }
#endif
  float cov=mix(1.05,.28,uCover);
  float base=fbm(uv*1.3+w)*.78+noise(uv*.33+w*.45)*.42;
  float dens=smoothstep(cov,cov+.32,base);
#ifdef CLOUD_SHADOW
  vec2 ts=normalize(uSun.y>-.1?uSun.xz+1e-4:uMoon.xz+1e-4)*.1;
  float bs=fbm(uv*1.3+w+ts)*.78+noise((uv+ts)*.33+w*.45)*.42;
  float shade=mix(1.,.28,smoothstep(cov-.05,cov+.45,bs));
#else
  float shade=mix(1.,.45,dens);
#endif
  float fwd=pow(max(dot(rd,uSun),0.),5.);
  vec3 col=amb*(.55+.45*(1.-dens))
    +uSunCol*dayL*shade*(1.1+fwd*(1.-dens)*3.)
    +MOONCOL*moonL*shade*.35*(1.+pow(max(dot(rd,uMoon),0.),6.)*2.);
  // storms: dark, heavy bases with darker turbulent cores
  col*=1.-uStorm*(dens*.4+.3*smoothstep(.55,.9,base));
  // lightning lights the thin edges more than the thick cores
  col+=fl*(1.3-dens);
  float ca=dens*smoothstep(.005,.14,rd.y);
  acc+=col*ca*(1.-a);
  a+=ca*(1.-a);
  if(uOvercast>.001){
    float dt=base;
#ifdef STORM_DETAIL
    // stratocumulus rolls lying across the wind
    vec2 du=uv*.8-w*.35;
    vec2 q=vec2(dot(du,uWind)*.6,dot(du,vec2(-uWind.y,uWind.x))*1.25);
    dt=mix(base,fbm(q+vec2(base*1.3)),.55);
#endif
    float da=uOvercast*smoothstep(0.,.07,rd.y)*(.8+.2*smoothstep(.3,.75,dt));
    vec3 dc=amb*(.74+.6*(dt-.5))*(1.-uStorm*(.45+.3*smoothstep(.35,.8,dt)));
    // thick overcast is brightest overhead; a storm is darkest overhead
    dc*=1.+(.16-.46*uStorm)*rd.y;
    dc+=uSunCol*dayL*(.22+.3*dt)+MOONCOL*moonL*.12;
    dc+=uSunCol*dayL*pow(max(dot(rd,uSun),0.),8.)*(1.2-dt)*1.5+MOONCOL*moonL*pow(max(dot(rd,uMoon),0.),8.)*.45;
    dc+=fl*(1.35-dt);
    acc+=dc*da*(1.-a);
    thin=clamp(1.2-dt*1.4,0.,1.)*(1.-uStorm)*da*(1.-a);
    a+=da*(1.-a);
  }
#ifdef CIRRUS
  vec2 cu=rd.xz/(rd.y+.2)*vec2(.4,1.6)+w*1.6;
  float ci=smoothstep(.55,.95,noise(cu*1.3)*.6+noise(cu*4.1)*.4)*.35*smoothstep(.02,.3,rd.y)*(.3+uCover*.7);
  vec3 cc=amb*1.2+uSunCol*dayL*1.3+MOONCOL*moonL*.3+fl*.6;
  acc+=cc*ci*(1.-a);
  a+=ci*(1.-a);
#endif
  return vec4(acc/max(a,1e-4),a);
}

vec3 stars(vec3 rd){
  if(uStars<.001) return vec3(0.);
  vec3 r=vec3(rd.x,rd.y*.788-rd.z*.616,rd.y*.616+rd.z*.788);
  float cs=cos(uSid),sn=sin(uSid);
  r=vec3(cs*r.x-sn*r.z,r.y,sn*r.x+cs*r.z);
  vec3 col=vec3(0.);
  for(int L=0;L<STAR_LAYERS;L++){
    float fl=float(L);
    vec3 p=r*(160.+fl*170.);
    vec3 id=floor(p);
    float h=hash3(id+fl*13.);
    if(h>.9){
      vec3 o=vec3(hash3(id+1.7),hash3(id+3.1),hash3(id+5.3))*.6+.2;
      float d=length(fract(p)-o);
      float b=fade(0.,.16,d)*(h-.9)*10.;
      b*=.65+.35*sin(uTime*(2.+h*5.)+h*90.);
      col+=b*mix(vec3(.7,.8,1.),vec3(1.,.85,.7),hash3(id+9.))*(1.4-fl*.6);
    }
  }
  vec3 mw=normalize(vec3(.3,.9,.32));
  float dm=dot(r,mw)*4.;
  col+=exp(-dm*dm)*vec3(.5,.55,.75)*(noise(r.xz*9.+r.y*5.)*.6+noise(r.xy*23.)*.4)*.09;
  return col*uStars*smoothstep(0.,.22,rd.y);
}

vec4 moonDisk(vec3 rd){
  float R=.028;
  if(dot(rd,uMoon)<cos(R*1.02)) return vec4(0.);
  vec3 rt=normalize(cross(vec3(0.,1.,0.),uMoon));
  vec3 up=cross(uMoon,rt);
  vec2 p=vec2(dot(rd,rt),dot(rd,up))/R;
  float r2=dot(p,p);
  if(r2>1.) return vec4(0.);
  float z=sqrt(1.-r2);
  vec3 n=p.x*rt+p.y*up-z*uMoon;
  float lit=smoothstep(-.03,.06,dot(n,uSun));
  float maria=noise(p*3.+4.)*.55+noise(p*9.)*.3+noise(p*22.)*.15;
  vec3 alb=vec3(.85,.87,.9)*(.6+.55*smoothstep(.35,.7,maria));
  vec3 c=alb*(lit*1.6*uMoonI+.025);
  return vec4(c*smoothstep(-.02,.03,uMoon.y),fade(.9,1.,r2));
}

// primary (42 deg) + reversed secondary (51 deg) bows, supernumerary fringe, bright inner sky
vec3 rainbow(float ang){
  float t=(ang-40.4)/2.4;
  float t2=(ang-50.3)/3.2;
  vec3 c=mix(hue(.78*(1.-clamp(t,0.,1.))),vec3(1.),.12)*smoothstep(0.,.3,t)*fade(.7,1.,t);
  c+=mix(hue(.78*clamp(t2,0.,1.)),vec3(1.),.12)*smoothstep(0.,.3,t2)*fade(.7,1.,t2)*.4;
  float s=(ang-38.9)/1.3;
  c+=vec3(.6,.85,.65)*smoothstep(0.,.5,s)*fade(.5,1.,s)*.14;
  c+=vec3(.05)*fade(36.,40.5,ang);
  return c;
}

// fogbow: broad, nearly white bow from tiny fog droplets (faint red outer / blue inner edge)
vec3 fogbow(float ang){
  float x=(ang-38.5)/3.2;
  return mix(vec3(.9,.95,1.05),vec3(1.05,.92,.85),smoothstep(-.4,.8,x))*exp(-x*x*1.6);
}

// piecewise-linear random walk gives a jagged lightning channel
float lpn(float s,float sd){float i=floor(s);return mix(hash(vec2(i,sd)),hash(vec2(i+1.,sd)),fract(s))-.5;}
float boltX(float y,float sd){return lpn(y*3.,sd)*.3+lpn(y*11.,sd+1.3)*.12+lpn(y*37.,sd+2.7)*.045;}
vec3 boltCol(vec3 rd){
  float fw=dot(rd.xz,uBoltAz);
  if(fw<.05) return vec3(0.);
  vec2 q=vec2(dot(rd.xz,vec2(uBoltAz.y,-uBoltAz.x)),rd.y)/fw;
  float top=uBoltTop;
  float yy=q.y/top;
  if(yy<-.03||yy>1.1||abs(q.x)>top*.8) return vec3(0.);
  float lw=uBoltW;
  float gw=lw*(5.+uRain*7.);   // rain and mist spread the glow
  float d=abs(q.x-boltX(yy,uBoltSeed)*top);
  float core=fade(lw*.5,lw*1.5,d);
  float glow=exp(-d/gw)*.5+exp(-d/(top*.05))*.12;
#if BOLT_BRANCHES > 0
  for(int k=0;k<BOLT_BRANCHES;k++){
    float fk=float(k);
    float y0=.3+.55*hash(vec2(uBoltSeed,fk+11.));
    float len=.18+.25*hash(vec2(fk+5.,uBoltSeed));
    float t=(y0-yy)/len;
    if(t>0.&&t<1.){
      float dir=hash(vec2(fk+2.,uBoltSeed+7.))>.5?1.:-1.;
      float xb=(boltX(y0,uBoltSeed)+dir*t*len*.8+boltX(yy*1.7,uBoltSeed+9.+fk)*.4*t)*top;
      float db=abs(q.x-xb);
      float fb=1.-t;
      core+=fade(lw*.3,lw*1.1,db)*.6*fb;
      glow+=exp(-db/(gw*.6))*.25*fb;
    }
  }
#endif
  // stepped leader: the channel grows down from the cloud base before the return stroke
  float grow=smoothstep(1.-uLeader-.04,1.-uLeader,yy);
  float m=uBolt*smoothstep(-.03,0.,yy)*fade(.88,1.08,yy)*grow*(1.-uRain*.3);
  return (vec3(1.)*core*5.+vec3(.6,.64,1.)*glow*2.4)*m;
}

// distant rain shafts hanging from the cloud base, leaning downwind, drifting with the cloud field
vec4 rainShafts(vec3 rd){
  float hl=max(length(rd.xz),.05);
  float el=rd.y/hl;
  if(el>.34||el<-.006) return vec4(0.);
  vec2 dir=rd.xz/hl;
  float a=atan(dir.x,dir.y)+leanAt(dir)*.8*el;
  vec2 cd=vec2(sin(a),cos(a));
  vec2 w=uWind*uCloudT;
  vec2 cu=cd*3.4;
  float cell=noise(cu*.33+w*.45)*.6+noise(cu*1.3+w)*.4;
  float m=smoothstep(mix(.78,.22,uShafts),mix(.98,.5,uShafts),cell);
  if(m<.001) return vec4(0.);
  float u=a*.15915494;
  float tm=mod(uTime,1000.);
  float tex=pnoise(vec2(u*240.,el*2.5+tm*.35),240.);
#ifdef STORM_DETAIL
  tex=tex*.6+pnoise(vec2(u*560.,el*5.+tm*.6),560.)*.4;
#endif
  float top=.07+.1*noise(cd*7.+w*.8);
  float vp=fade(top*.3,top,el)*smoothstep(-.006,.001,el);
  // grey veil, glowing silver-gold when the sun is behind it
  vec3 sc=mix(uZen,uHor,.6)*.8*(1.-uStorm*.35)
    +uSunCol*uSunI*pow(max(dot(rd,uSun),0.),5.)*1.3*smoothstep(-.1,.05,uSun.y)
    +flashL(rd)*.5;
  return vec4(sc,m*(.55+.45*tex)*vp*min(uShafts*1.3,1.)*.72);
}

vec3 waveN(vec2 p,float t,out float crest){
  vec2 g=vec2(0.);
  float a=.9*uWave,f=.11,asum=0.;
  float ang=atan(uWind.y,uWind.x);
  float chop=1.+uWindS*.8;
  crest=0.;
  for(int i=0;i<WAVES;i++){
    float fi=float(i);
    float th=ang+sin(fi*2.39)*(1.1-uWindS*.45);
    vec2 d=vec2(cos(th),sin(th));
    float ph=dot(d,p)*f+uTime*sqrt(9.8*f)+fi*2.1;
    float e=exp(chop*(sin(ph)-1.));
    float fw=clamp(1.6-f*t*.012,0.,1.);
    g+=d*(a*f*chop*e*cos(ph))*fw;
    if(i<4){crest+=a*e*fw;asum+=a;}
    a*=.74;f*=1.33;
  }
  crest/=max(asum,1e-4);
  return normalize(vec3(-g.x,1.,-g.y));
}

#ifdef RAIN_RIPPLES
// expanding rings from raindrop impacts (analytic gradient) + tiny splash crowns at birth
vec3 ripples(vec2 p,float t){
  vec3 acc=vec3(0.);
  for(int k=0;k<RIPPLE_GRIDS;k++){
    float fk=float(k);
    vec2 q=p*(1.6+fk*.53)+fk*vec2(5.3,1.7);
    vec2 id=floor(q),f=fract(q);
    float h=hash(id+fk*19.1);
    float ph=fract(t*(.9+.4*h)+h*9.3);
    float on=step(fract(h*43.7),uRain);
    vec2 o=vec2(fract(h*7.7),fract(h*3.3))*.4+.3;
    vec2 dv=f-o;
    float d=length(dv)+1e-4;
    float x=(d-ph*.3)*34.;
    float env=(1.-ph)*(1.-ph)*exp(-x*x*.06)*on;
    acc.xy+=dv/d*cos(x)*env;
    acc.z+=on*fade(0.,.1,ph)*fade(.02,.07,d);
  }
  return acc;
}
#endif

#ifdef CLOUD_SHADOW
// cloud shadows on the sea: project along the light to the cumulus layer
float seaShadow(vec3 p){
  vec3 L=uSun.y>-.02?uSun:uMoon;
  vec2 uv=(p.xz/CLOUD_H+L.xz/max(L.y,.1))*.55;
  vec2 w=uWind*uCloudT;
  vec2 q=uv*1.3+w;
  float b=(noise(q)*.5+noise(q*2.03+vec2(1.7,9.2))*.25+.11)*.78+noise(uv*.33+w*.45)*.42;
  float cov=mix(1.05,.28,uCover);
  return 1.-smoothstep(cov,cov+.32,b)*.8*(1.-uOvercast*.8);
}
#endif

vec3 sky(vec3 rd,vec3 H,vec4 sh){
  vec3 c=skyBase(rd);
  vec4 m=moonDisk(rd);
  c+=stars(rd)*(1.-m.a);
  c=mix(c,c*.3+m.rgb,m.a);
  float sd=dot(rd,uSun);
  float sunVis=uSunI*smoothstep(-.02,.01,uSun.y);
  c+=uSunCol*smoothstep(.99992,.99996,sd)*18.*sunVis;
  float thin;
  vec4 cl=clouds(rd,thin);
  c=mix(c,cl.rgb,cl.a);
  // sun and moon glimpsed through thinner parts of the deck: soft, glare-free discs
  c+=(uSunCol*(smoothstep(.99985,.99994,sd)*5.+pow(max(sd,0.),300.)*.4)*sunVis+m.rgb*m.a*.8)*thin*.5;
  // 22 deg ice-crystal halo in a thin veil (sharp red inner edge, diffuse outer edge)
  if(uHalo>.001){
    float ds0=angTo(rd,uSun)-22.,dm0=angTo(rd,uMoon)-22.;
    float rs=exp(-ds0*ds0*(ds0<0.?3.:.35)),rm=exp(-dm0*dm0*(dm0<0.?3.:.35));
    vec3 hs=mix(vec3(1.,.72,.55),vec3(.92,.96,1.),smoothstep(-.8,1.,ds0));
    vec3 hm=mix(vec3(1.,.8,.7),vec3(.9,.95,1.),smoothstep(-.8,1.,dm0));
    c+=(hs*rs*uSunCol*uSunI*smoothstep(-.02,.05,uSun.y)*.16
      +hm*rm*MOONCOL*uMoonI*uMoonLit*smoothstep(-.02,.05,uMoon.y)*.6)*uHalo;
  }
  if(uBolt>.001) c+=boltCol(rd);
  c=mix(c,sh.rgb,sh.a);
  float ang=0.;
  if(uRainbow+uFogbow>.001) ang=angTo(rd,-uSun);
  if(uRainbow>.001){
    // the bow lives in the rain: most vivid on the rain shafts; darker Alexander band outside it
    float rb=uRainbow*smoothstep(0.,.03,rd.y)*(.45+1.1*sh.a);
    c*=1.-rb*.12*smoothstep(42.,43.,ang)*fade(49.5,50.5,ang);
    c+=rainbow(ang)*rb*uSunCol*uSunI*.9;
  }
  // aerial perspective, rain veil and wind-blown spray toward the horizon
  float y=max(rd.y,0.);
  float hz=exp(-y*mix(40.,6.,uHaze));
  c=mix(c,H,clamp(hz*(.35+.6*uHaze)+uRain*.55*exp(-y*9.),0.,1.));
  if(uSpray>.001) c=mix(c,H*1.12,uSpray*.3*exp(-y*90.));
  if(uFog>.001){
    float T=exp(-fogOD(rd,0.));
    c=mix(H,c,T);
    if(uFogbow>.001) c+=fogbow(ang)*uFogbow*(1.-T)*uSunCol*uSunI*.45;
  }
  return c;
}

vec3 ocean(vec3 rd,vec3 H,vec4 sh){
  float t=uCamH/-min(rd.y,-.0004);
  vec3 p=vec3(0.,uCamH,0.)+rd*t;
  float crest;
  vec3 n=waveN(p.xz,t,crest);
  float dist=smoothstep(0.,1.,t/1500.);
  n=normalize(mix(n,vec3(0.,1.,0.),dist*.85));
  float splash=0.;
#ifdef RAIN_RIPPLES
  if(uRain>.01&&t<90.){
    vec3 rg=ripples(p.xz,uTime);
    float rk=uRain*exp(-t*.035);
    n=normalize(n+vec3(-rg.x,0.,-rg.y)*.2*rk);
    splash=rg.z*rk;
  }
#endif
  float ndv=max(dot(-rd,n),0.);
  float fr=.02+.98*pow(max(1.-ndv,0.),5.);
  vec3 rf=reflect(rd,n);
  rf.y=abs(rf.y)+.001;
  rf=normalize(rf);
  vec3 refl=skyBase(rf);
#ifdef REFL_CLOUDS
  float th;
  vec4 cl=clouds(rf,th);
  refl=mix(refl,cl.rgb,cl.a*.85);
#endif
  if(uBolt>.001) refl+=boltCol(rf)*.5;
  vec3 amb=uZen*.6+uHor*.4;
  // rain-roughened surface: reflections turn matte and grey
  refl=mix(refl,amb*1.05,uRain*.35);
  float shd=1.;
#ifdef CLOUD_SHADOW
  shd=seaShadow(p);
#endif
  float sunUp=max(uSun.y,0.);
  vec3 sunL=uSunCol*uSunI*shd;
  vec3 deep=mix(vec3(.012,.13,.19),vec3(.03,.07,.075),clamp(uStorm*.7+uOvercast*.3,0.,1.));
  vec3 body=deep*(amb*.9+sunL*sunUp*.55);
  float sss=pow(max(dot(rd,-uSun*vec3(1.,0.,1.)),0.),2.)*max(n.x*rd.x+n.z*rd.z,0.);
  body+=vec3(.02,.3,.26)*sunL*sunUp*(.25+sss*3.)*(1.-uStorm*.6);
  vec3 col=mix(body,refl,fr);
  float glint=(1.-uCover*.6)*(1.-uRain*.6)*shd;
  float sd=max(dot(rf,uSun),0.);
  float gx=mix(900.,280.,uRain);
  col+=uSunCol*(pow(sd,gx)*60.*gx/900.+pow(sd,70.)*1.1)*uSunI*smoothstep(-.02,.03,uSun.y)*glint;
  float md=max(dot(rf,uMoon),0.);
  col+=MOONCOL*(pow(md,500.)*14.+pow(md,40.)*.5)*uMoonI*uMoonLit*smoothstep(-.02,.08,uMoon.y)*glint;
  vec3 fc=amb*1.25+sunL*sunUp*.8+MOONCOL*uMoonI*uMoonLit*max(uMoon.y,0.)*.3+FLASHCOL*uFlash*.4;
  // whitecaps on wave crests + wind-blown foam streaks
  if(uWindS>.25){
    float nearF=1.-dist;
    float fm=smoothstep(.55-uWindS*.1,.9,crest)*(noise(p.xz*.3+uTime*.15)*.7+.3);
    vec2 wp=vec2(dot(p.xz,uWind)*.05,dot(p.xz,vec2(-uWind.y,uWind.x))*.5);
    fm+=smoothstep(.62,.92,noise(wp+vec2(uTime*.2,0.)))*smoothstep(.5,1.,uWindS)*.35;
    fm*=smoothstep(.25,.8,uWindS)*nearF;
    col=mix(col,fc,clamp(fm,0.,1.)*.85);
  }
  col+=fc*splash*.5;
  col=mix(col,sh.rgb,sh.a);
  // aerial perspective (haze + rain veil), spindrift, fog
  float fd=.0012*(.3+uHaze*1.4)+uRain*.0035;
  col=mix(H,col,exp(-t*fd));
  if(uSpray>.001) col=mix(col,H*1.12,uSpray*.3*(1.-exp(-t*.006)));
  if(uFog>.001){
    float T=exp(-fogOD(rd,t));
    col=mix(H,col,T);
    if(uFogbow>.001) col+=fogbow(angTo(rd,-uSun))*uFogbow*(1.-T)*uSunCol*uSunI*.45;
  }
  return col;
}

#if PRECIP_LAYERS > 0
// rain streaks on nested cylinders around the camera: motion blur from real fall speed,
// defocus for near drops (focus at infinity), sub-pixel far drops fade instead of aliasing
float rainStreaks(vec3 rd,vec2 dir,float hl){
  float el=rd.y/hl;
  float az=atan(dir.x,dir.y);
  float px=2./(uRes.y*1.55);
  float sl=leanAt(dir)*.8;
  float tm=mod(uTime,1000.);
  float v=mix(3.5,9.,sqrt(uRain));
  float dsz=mix(.0012,.0032,uRain);
  // sheets of heavier rain sweeping past in the gusts
  float sheet=noise(dir*1.8+uWind*uCloudT*2.+vec2(uTime*.04,el*.3));
  float dens=clamp(uRain*(.4+1.2*sheet*(.55+.45*uGust)),0.,.9)*.6;
  float acc=0.;
  for(int L=0;L<PRECIP_LAYERS;L++){
    float fl=float(L);
    float R=RAIN_R0*pow(1.8,fl);
    float N=floor(6.2831853*R/.2);
    float k=N/6.2831853;
    float ch=v*.028/R*2.4;
    float cx=(az+sl*el)*k;
    float ci=mod(floor(cx),N);
    float hc=hash(vec2(ci,fl*7.13+.5));
    float cy=(el+tm*v/R*(.85+.3*hc))/ch+hc*13.;
    float h=hash(vec2(ci,mod(floor(cy),251.))+fl*17.31);
    float x0=.2+.6*fract(h*13.7);
    float y0=fract(h*71.3)*.58;
    float ty=(fract(cy)-y0)/.42;
    float dx=(fract(cx)-x0)/k*hl;
    float W=px*.8+dsz/R+.004/R;
    float prof=exp(-2.*dx*dx/(W*W));
    float env=smoothstep(0.,.18,ty)*fade(.7,1.,ty)*smoothstep(-uCamH/R-.03,-uCamH/R,el);
    float br=min(1.,dsz*1.4/(R*W))*(.55+.45*fract(h*5.1));
    acc+=step(h,dens)*prof*env*br;
  }
  return acc;
}
#endif

void main(){
  vec2 uv=(gl_FragCoord.xy*2.-uRes)/uRes.y;
  vec3 rd=normalize(uCam*vec3(uv,1.55));
  vec3 H=horizonHaze(rd);
  vec4 sh=vec4(0.);
  if(uShafts>.01) sh=rainShafts(rd);
  vec3 col;
  if(rd.y>=0.) col=sky(rd,H,sh);
  else col=ocean(rd,H,sh);
#if PRECIP_LAYERS > 0
  if(uRain>.003){
    float hl=max(length(rd.xz),.05);
    vec2 dir=rd.xz/hl;
    float r=rainStreaks(rd,dir,hl);
    // drops refract a wide cone of sky: roughly mean sky radiance + forward-scattered sun / lightning
    vec3 rc=mix(uZen,uHor,.45)*1.25
      +uSunCol*uSunI*pow(max(dot(rd,uSun),0.),6.)*1.6*smoothstep(-.05,.05,uSun.y)
      +MOONCOL*uMoonI*uMoonLit*pow(max(dot(rd,uMoon),0.),8.)*.4
      +FLASHCOL*uFlash*1.8;
    rc=mix(rc,H,uFog*.5);
    col=mix(col,rc,clamp(r,0.,1.)*.6*fade(1.3,2.4,abs(rd.y)/hl));
  }
#endif
  col*=uExp;
  col=(col*(2.51*col+.03))/(col*(2.43*col+.59)+.14);
  col=pow(clamp(col,0.,1.),vec3(1./2.2));
  vec2 q=gl_FragCoord.xy/uRes;
  col*=.88+.12*pow(16.*q.x*q.y*(1.-q.x)*(1.-q.y),.15);
  col+=(hash(gl_FragCoord.xy+fract(uTime))-.5)/255.;
  gl_FragColor=vec4(col,1.);
}
`;

export function buildFrag(q: QualitySettings) {
  const defs = [
    `#define WAVES ${q.waves}`,
    `#define CLOUD_OCT ${q.cloudOct}`,
    `#define STAR_LAYERS ${q.starLayers}`,
    `#define PRECIP_LAYERS ${q.precipLayers}`,
    `#define RAIN_R0 ${q.rainR0.toFixed(2)}`,
    `#define BOLT_BRANCHES ${q.boltBranches}`,
    `#define RIPPLE_GRIDS ${q.rippleGrids}`,
    q.cloudShadow ? '#define CLOUD_SHADOW' : '',
    q.reflClouds ? '#define REFL_CLOUDS' : '',
    q.cirrus ? '#define CIRRUS' : '',
    q.stormDetail ? '#define STORM_DETAIL' : '',
    q.rippleGrids > 0 ? '#define RAIN_RIPPLES' : '',
    q.fogDetail ? '#define FOG_DETAIL' : '',
  ].join('\n');
  return `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
${defs}
${BODY}`;
}
