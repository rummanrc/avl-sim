// Small, procedural driving soundtrack: no downloads or audio assets.
export class DrivingAudio {
  constructor(onChange=()=>{}) {
    this.onChange=onChange;this.enabled=true;this.background=false;this.context=null;this.elapsed=0;
    try{this.enabled=localStorage.getItem('tokyo-drive-sound')!=='off';}catch{}
  }
  async unlock() {
    if(!this.enabled||this.background)return;
    try {
      if(!this.context)this.create();
      await this.context.resume();
    }catch {
      this.enabled=false;this.unavailable=true;
    }
    this.onChange();
  }
  create() {
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)throw Error('Web Audio unavailable');
    const ctx=this.context=new Audio({latencyHint:'interactive'});
    ctx.onstatechange=()=>this.onChange();
    this.master=ctx.createGain();this.master.gain.value=.42;
    const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-14;limiter.knee.value=12;limiter.ratio.value=6;
    this.analyser=ctx.createAnalyser();this.analyser.fftSize=512;this.waveform=new Float32Array(512);
    this.master.connect(limiter);limiter.connect(this.analyser);this.analyser.connect(ctx.destination);
    this.noise=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
    const samples=this.noise.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
    const real=new Float32Array(17),imag=new Float32Array(17);
    // A strong fundamental and rapidly softened harmonics give a bassy exhaust
    // rather than the bright, buzzy sawtooth quality of the original engine.
    const harmonics=[0,1,.52,.24,.14,.08,.05];
    for(let i=1;i<imag.length;i++)imag[i]=harmonics[i]??.025/i;
    const wave=ctx.createPeriodicWave(real,imag);
    this.engineFilter=ctx.createBiquadFilter();this.engineFilter.type='lowpass';this.engineFilter.frequency.value=340;this.engineFilter.Q.value=.7;
    this.engine=ctx.createGain();this.engine.gain.value=0;this.engineFilter.connect(this.engine);this.engine.connect(this.master);
    this.motor=ctx.createOscillator();this.motor.setPeriodicWave(wave);this.motor.frequency.value=27;this.motor.connect(this.engineFilter);this.motor.start();
    this.harmonic=ctx.createOscillator();this.harmonic.type='triangle';this.harmonic.frequency.value=26.6;
    const harmonicGain=ctx.createGain();harmonicGain.gain.value=.38;this.harmonic.connect(harmonicGain);harmonicGain.connect(this.engineFilter);this.harmonic.start();
    this.exhaust=this.noiseLayer('lowpass',220);
    // Slightly uneven exhaust pulses add a throaty rumble under the pitched note.
    this.pulse=ctx.createOscillator();this.pulse.type='sine';this.pulse.frequency.value=13.5;
    this.pulseDepth=ctx.createGain();this.pulseDepth.gain.value=0;this.pulse.connect(this.pulseDepth);this.pulseDepth.connect(this.exhaust.gain.gain);this.pulse.start();
    this.road=this.noiseLayer('lowpass',1000);
    this.boost=this.noiseLayer('bandpass',1900);
    this.tyres=this.noiseLayer('bandpass',1400);
    this.whine=this.toneLayer('sine',450);
    this.squeal=this.toneLayer('sine',780);
  }
  noiseLayer(type,frequency) {
    const ctx=this.context,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=this.noise;source.loop=true;filter.type=type;filter.frequency.value=frequency;filter.Q.value=.7;gain.gain.value=0;
    source.connect(filter);filter.connect(gain);gain.connect(this.master);source.start();return {source,filter,gain};
  }
  toneLayer(type,frequency) {
    const source=this.context.createOscillator(),gain=this.context.createGain();source.type=type;source.frequency.value=frequency;gain.gain.value=0;
    source.connect(gain);gain.connect(this.master);source.start();return {source,gain};
  }
  smooth(param,value,time=.065) {param.setTargetAtTime(value,this.context.currentTime,time);}
  get outputLevel() {
    if(!this.analyser||this.context.state!=='running')return 0;
    this.analyser.getFloatTimeDomainData(this.waveform);
    return Math.sqrt(this.waveform.reduce((sum,value)=>sum+value*value,0)/this.waveform.length);
  }
  update(state,keys,dt) {
    if(!this.context||this.context.state!=='running')return;
    this.elapsed+=dt;if(this.elapsed<1/30)return;this.elapsed=0;
    const active=this.enabled&&!this.background&&!state.paused;
    this.smooth(this.master.gain,active?.42:0,.025);
    const running=active&&state.ignition,kmh=Math.abs(state.speed)*3.6;
    const throttle=keys.has('KeyW')||keys.has('ArrowUp')||state.nitroActive;
    // Virtual gear shifts give revs a rise/fall while speed remains continuous.
    const gears=[0,26,48,80,120,180];let gear=0;while(gear<gears.length-2&&kmh>=gears[gear+1])gear++;
    const revs=kmh<3?27:(gear===0?27:35)+Math.min(1,(kmh-gears[gear])/(gears[gear+1]-gears[gear]))*43+(throttle?5:0);
    this.smooth(this.motor.frequency,revs,.12);this.smooth(this.harmonic.frequency,revs*.985,.12);
    this.smooth(this.pulse.frequency,revs*.5,.12);
    this.smooth(this.pulseDepth.gain,running?.018:0);
    this.smooth(this.engineFilter.frequency,220+revs*3+(throttle?80:0));
    this.smooth(this.engine.gain,running?(throttle?.3:.23):0);
    this.smooth(this.exhaust.gain.gain,running?.045+Math.min(kmh/160*.04,.04):0);
    this.smooth(this.exhaust.filter.frequency,170+revs*2);
    this.smooth(this.road.gain.gain,running?Math.min(.2,kmh/160*.2):0);
    this.smooth(this.road.filter.frequency,500+kmh*9);
    this.smooth(this.boost.gain.gain,running&&state.nitroActive?.27:0,.09);
    this.smooth(this.whine.gain.gain,running&&state.nitroActive?.02:0,.09);
    this.smooth(this.whine.source.frequency,260+kmh*3,.12);
    const braking=keys.has('Space')||((keys.has('KeyS')||keys.has('ArrowDown'))&&state.speed>0);
    const turning=keys.has('KeyA')||keys.has('KeyD')||keys.has('ArrowLeft')||keys.has('ArrowRight');
    const skid=running?Math.min(1,Math.max(braking?(kmh-8)/55:0,turning?(kmh-65)/70:0)):0;
    this.smooth(this.tyres.gain.gain,Math.max(0,skid)*.22,.04);
    this.smooth(this.squeal.gain.gain,Math.max(0,skid)*.035,.04);
    this.smooth(this.squeal.source.frequency,780+kmh*2);
  }
  burst({type='noise',frequency=160,end=60,gain=.3,duration=.3,filter=900,delay=0}) {
    const ctx=this.context;if(!ctx||ctx.state!=='running'||!this.enabled||this.background)return;
    const start=ctx.currentTime+delay,source=type==='noise'?ctx.createBufferSource():ctx.createOscillator();
    if(type==='noise')source.buffer=this.noise;
    else{source.type=type;source.frequency.setValueAtTime(frequency,start);source.frequency.exponentialRampToValueAtTime(end,start+duration);}
    const tone=ctx.createBiquadFilter();tone.type='lowpass';tone.frequency.value=filter;
    const envelope=ctx.createGain();envelope.gain.setValueAtTime(0,start);envelope.gain.linearRampToValueAtTime(gain,start+.012);envelope.gain.exponentialRampToValueAtTime(.0001,start+duration);
    source.connect(tone);tone.connect(envelope);envelope.connect(this.master);source.start(start);source.stop(start+duration+.02);
    source.onended=()=>{source.disconnect();tone.disconnect();envelope.disconnect();};
  }
  ignition(on) {
    if(on){for(let i=0;i<5;i++)this.burst({gain:.2,filter:230,duration:.07,delay:i*.065});this.burst({type:'triangle',frequency:19,end:32,filter:300,gain:.2,duration:.4});}
    else this.burst({type:'triangle',frequency:42,end:18,gain:.2,duration:.28,filter:220});
  }
  impact(speed) {this.burst({gain:Math.min(.65,Math.abs(speed)/30),filter:450,duration:.22});this.burst({type:'sine',frequency:100,end:28,gain:.25,duration:.2});}
  checkpoint() {for(let i=0;i<3;i++)this.burst({type:'sine',frequency:[523,659,784][i],end:[523,659,784][i],gain:.12,filter:2000,duration:.22,delay:i*.09});}
  async toggle() {
    if(this.unavailable)return;
    this.enabled=!this.enabled;try{localStorage.setItem('tokyo-drive-sound',this.enabled?'on':'off');}catch{}
    if(this.context)this.smooth(this.master.gain,this.enabled?.42:0,.015);
    this.onChange();if(this.enabled)await this.unlock();
  }
  setBackground(value) {
    this.background=value;
    if(value&&this.context){this.master.gain.cancelScheduledValues(this.context.currentTime);this.master.gain.value=0;void this.context.suspend().catch(()=>{});}
    // Resume only on the next deliberate click/key, as required by autoplay policies.
  }
}
