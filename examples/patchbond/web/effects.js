const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const setupDither = () => {
  const canvas = document.querySelector('#dither-background')
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' })
  if (!gl) { canvas.hidden = true; return }
  const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Dither shader failed'); return shader }
  const vertex = compile(gl.VERTEX_SHADER, `attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0.0,1.0);}`)
  const fragment = compile(gl.FRAGMENT_SHADER, `
    precision highp float;
    uniform vec2 u_resolution;uniform vec2 u_mouse;uniform float u_time;
    float bayer4(vec2 p){vec2 q=mod(floor(p),4.0);float x=q.x;float y=q.y;if(y<1.0){if(x<1.0)return 0.0;if(x<2.0)return 8.0;if(x<3.0)return 2.0;return 10.0;}if(y<2.0){if(x<1.0)return 12.0;if(x<2.0)return 4.0;if(x<3.0)return 14.0;return 6.0;}if(y<3.0){if(x<1.0)return 3.0;if(x<2.0)return 11.0;if(x<3.0)return 1.0;return 9.0;}if(x<1.0)return 15.0;if(x<2.0)return 7.0;if(x<3.0)return 13.0;return 5.0;}
    void main(){vec2 uv=gl_FragCoord.xy/u_resolution;vec2 aspect=vec2(u_resolution.x/u_resolution.y,1.0);vec2 p=(uv-0.5)*aspect;float t=u_time*0.32;float frequency=2.0;float amplitude=0.09;float colors=5.5;float wave=sin((p.x+p.y*0.34)*6.28318*frequency+t)*0.55+sin((p.y-p.x*0.22)*6.28318*frequency-t*0.8)*0.45;vec2 mouse=(u_mouse/u_resolution-0.5)*aspect;float influence=exp(-dot(p-mouse,p-mouse)*12.0)*0.055;float value=clamp(0.42+wave*amplitude+influence,0.0,1.0);float threshold=((bayer4(gl_FragCoord.xy)/16.0)-0.5)/colors;float quantized=floor(clamp(value+threshold,0.0,1.0)*(colors-1.0)+0.5)/(colors-1.0);vec3 low=vec3(0.012,0.014,0.021);vec3 high=vec3(0.24,0.18,0.48);vec3 color=mix(low,high,quantized*0.78);gl_FragColor=vec4(color,0.92);}`)
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Dither program failed')
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position'); const resolution = gl.getUniformLocation(program, 'u_resolution'); const mouse = gl.getUniformLocation(program, 'u_mouse'); const time = gl.getUniformLocation(program, 'u_time')
  const pointer = { x: innerWidth * 0.5, y: innerHeight * 0.25 }; let lastFrame = 0
  const resize = () => { const pixelSize = reducedMotion ? 4 : 2; canvas.width = Math.max(1, Math.ceil(innerWidth / pixelSize)); canvas.height = Math.max(1, Math.ceil(innerHeight / pixelSize)); gl.viewport(0, 0, canvas.width, canvas.height) }
  const render = (now = 0) => { if (!reducedMotion && now - lastFrame < 32) { requestAnimationFrame(render); return } lastFrame = now; gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0); gl.uniform2f(resolution, canvas.width, canvas.height); gl.uniform2f(mouse, pointer.x / innerWidth * canvas.width, (1 - pointer.y / innerHeight) * canvas.height); gl.uniform1f(time, now / 1000); gl.drawArrays(gl.TRIANGLES, 0, 6); if (!reducedMotion) requestAnimationFrame(render) }
  addEventListener('resize', resize, { passive: true }); addEventListener('pointermove', (event) => { pointer.x = event.clientX; pointer.y = event.clientY }, { passive: true }); resize(); render()
}

const setupClickEffects = () => {
  if (reducedMotion) return
  const container = document.querySelector('#click-effects')
  const gsap = window.gsap
  if (!gsap) { console.warn('OriginKit burst unavailable: GSAP did not load'); return }
  const effectSize = 90
  const duration = 0.3
  const strokeWidth = 2
  const color = '#ffffff'
  const angles = [45, 80, 115, 150]
  const svgNamespace = 'http://www.w3.org/2000/svg'

  const handleClick = (event) => {
    const rect = container.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const centerX = effectSize / 2
    const centerY = effectSize / 2
    const svg = document.createElementNS(svgNamespace, 'svg')
    svg.setAttribute('viewBox', `0 0 ${effectSize} ${effectSize}`)
    Object.assign(svg.style, {
      position: 'absolute', left: `${x - effectSize / 2}px`, top: `${y - effectSize / 2}px`,
      width: `${effectSize}px`, height: `${effectSize}px`, pointerEvents: 'none',
      overflow: 'visible', transform: 'rotate(0deg)', transformOrigin: 'center',
    })
    container.append(svg)

    angles.forEach((degrees, index) => {
      const angle = degrees * Math.PI / 180
      const startX = centerX + effectSize * 0.1 * Math.cos(angle)
      const startY = centerY - effectSize * 0.1 * Math.sin(angle)
      const endX = centerX + effectSize * 0.25 * Math.cos(angle)
      const endY = centerY - effectSize * 0.25 * Math.sin(angle)
      const line = document.createElementNS(svgNamespace, 'line')
      line.setAttribute('stroke', color)
      line.setAttribute('stroke-linecap', 'square')
      svg.append(line)
      gsap.set(line, { attr: { x1: startX, y1: startY, x2: endX, y2: endY }, strokeWidth })
      gsap.timeline().to(line, {
        attr: { x1: endX, y1: endY, x2: endX, y2: endY },
        translateX: effectSize / 4 * Math.cos(angle),
        translateY: -effectSize / 4 * Math.sin(angle),
        duration,
        ease: 'power2.out',
        ...(index === angles.length - 1 ? { onComplete: () => svg.remove() } : {}),
      }).to(line, { strokeWidth: 0, duration: duration * 0.4, ease: 'linear' }, duration * 0.6)
    })
  }

  document.addEventListener('click', handleClick)
}

try { setupDither() } catch (error) { console.warn('Dither background unavailable:', error) }
setupClickEffects()
