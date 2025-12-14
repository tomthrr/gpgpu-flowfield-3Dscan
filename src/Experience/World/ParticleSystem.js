import * as THREE from 'three'
import gsap from 'gsap'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'
import gpgpuParticlesShader from './shaders/gpgpu/particles.glsl'
import particlesFragmentShader from './shaders/particles/fragment.glsl'
import particlesVertexShader from './shaders/particles/vertex.glsl'

export default class ParticlesSystem {
    constructor(config = {}) {
        this.scene = config.scene
        this.renderer = config.renderer
        this.sizes = config.sizes
        this.model = config.model // ✅ modèle d’attente UNIQUE
        this.multiplier = config.multiplier || 2
        this.debugFolder = config.debugFolder || null

        this.baseGeometry = {}
        this.gpgpu = {}
        this.particles = {}

        this.debugObject = {
            uSize: config.uSize || 0.07,
            uFlowFieldInfluence: 1,
            uFlowFieldStrength: 6,
            uFlowFieldFrequency: 0.5
        }

        this.init()
    }

    /* ---------------- INIT ---------------- */

    init() {
        this.setupGeometries()
        this.setupGPUCompute()
        this.setupParticles()
        this.setupResize()
        if (this.debugFolder) this.setupDebug()
    }

    /* ---------------- GEOMETRY ---------------- */

    setupGeometries() {
        const positions = []
        const uvs = []

        this.model.traverse((child) => {
            if (!child.isMesh) return

            const geo = child.geometry.clone()
            geo.applyMatrix4(child.matrixWorld)

            const pos = geo.getAttribute('position')
            const uv = geo.getAttribute('uv')

            for (let i = 0; i < pos.count; i++) {
                positions.push(
                    pos.getX(i),
                    pos.getY(i),
                    pos.getZ(i)
                )
            }

            if (uv) {
                for (let i = 0; i < uv.count; i++) {
                    uvs.push(
                        uv.getX(i),
                        uv.getY(i)
                    )
                }
            }
        })

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2))

        this.baseGeometry.instance = geometry
        this.baseGeometry.count = geometry.attributes.position.count

        this.mapTexture = this.findTexture(this.model) || this.createWhiteTexture()

        console.log('Particles from waiting model:', this.baseGeometry.count)
    }

    findTexture(model) {
        let found = null
        model.traverse((child) => {
            if (child.isMesh && child.material?.map && !found) {
                found = child.material.map
            }
        })
        return found
    }

    createWhiteTexture() {
        const data = new Uint8Array([255, 255, 255, 255])
        const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
        tex.needsUpdate = true
        return tex
    }

    /* ---------------- GPGPU ---------------- */

    setupGPUCompute() {
        const size = Math.ceil(Math.sqrt(this.baseGeometry.count)) * this.multiplier
        this.gpgpu.size = size

        this.gpgpu.computation = new GPUComputationRenderer(size, size, this.renderer)
        this.gpgpu.baseTexture = this.gpgpu.computation.createTexture()

        for (let i = 0; i < size * size; i++) {
            const i4 = i * 4
            const i3 = (i % this.baseGeometry.count) * 3

            this.gpgpu.baseTexture.image.data[i4 + 0] =
                this.baseGeometry.instance.attributes.position.array[i3 + 0]
            this.gpgpu.baseTexture.image.data[i4 + 1] =
                this.baseGeometry.instance.attributes.position.array[i3 + 1]
            this.gpgpu.baseTexture.image.data[i4 + 2] =
                this.baseGeometry.instance.attributes.position.array[i3 + 2]
            this.gpgpu.baseTexture.image.data[i4 + 3] = Math.random()
        }

        this.gpgpu.variable = this.gpgpu.computation.addVariable(
            'uParticles',
            gpgpuParticlesShader,
            this.gpgpu.baseTexture
        )

        this.gpgpu.computation.setVariableDependencies(this.gpgpu.variable, [this.gpgpu.variable])

        const u = this.gpgpu.variable.material.uniforms
        u.uTime = new THREE.Uniform(0)
        u.uDeltaTime = new THREE.Uniform(0)
        u.uBase = new THREE.Uniform(this.gpgpu.baseTexture)
        u.uFlowFieldInfluence = new THREE.Uniform(this.debugObject.uFlowFieldInfluence)
        u.uFlowFieldStrength = new THREE.Uniform(this.debugObject.uFlowFieldStrength)
        u.uFlowFieldFrequency = new THREE.Uniform(this.debugObject.uFlowFieldFrequency)

        this.gpgpu.computation.init()
    }

    /* ---------------- PARTICLES ---------------- */

    setupParticles() {
        const maxParticles = this.gpgpu.size * this.gpgpu.size

        const uvArray = new Float32Array(maxParticles * 2)
        for (let y = 0; y < this.gpgpu.size; y++) {
            for (let x = 0; x < this.gpgpu.size; x++) {
                const i = y * this.gpgpu.size + x
                uvArray[i * 2 + 0] = (x + 0.5) / this.gpgpu.size
                uvArray[i * 2 + 1] = (y + 0.5) / this.gpgpu.size
            }
        }

        const sizeArray = new Float32Array(maxParticles)
        for (let i = 0; i < maxParticles; i++) sizeArray[i] = Math.random()

        const geometry = new THREE.BufferGeometry()
        geometry.setDrawRange(0, this.baseGeometry.count)

        geometry.setAttribute('aParticlesUv', new THREE.BufferAttribute(uvArray, 2))
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizeArray, 1))
        geometry.setAttribute(
            'aUv',
            new THREE.BufferAttribute(this.baseGeometry.instance.attributes.uv.array, 2)
        )

        const material = new THREE.ShaderMaterial({
            vertexShader: particlesVertexShader,
            fragmentShader: particlesFragmentShader,
            transparent: true,
            uniforms: {
                uSize: new THREE.Uniform(this.debugObject.uSize),
                uOpacity: new THREE.Uniform(1),
                uResolution: new THREE.Uniform(
                    new THREE.Vector2(
                        this.sizes.width * this.sizes.pixelRatio,
                        this.sizes.height * this.sizes.pixelRatio
                    )
                ),
                uParticlesTexture: new THREE.Uniform(),
                uModelTexture: new THREE.Uniform(this.mapTexture)
            }
        })

        this.particles.points = new THREE.Points(geometry, material)
        this.particles.geometry = geometry
        this.particles.material = material

        this.scene.add(this.particles.points)
    }

    /* ---------------- TRANSITION ---------------- */

    transitionToModel(targetModel) {
        console.log(targetModel)
        if (!targetModel) return

        gsap.timeline()
            .to(this.particles.material.uniforms.uOpacity, {
                value: 0,
                duration: 4,
                ease: 'power2.inOut'
            })
            // transition to new model
            .add(() => {
                this.replaceGeometry(targetModel)
            })
            // effect after transition
            .to(this.particles.material.uniforms.uOpacity, {
                value: 1,
                duration: 0.8,
                ease: 'power2.out'
            })
            .to(this.gpgpu.variable.material.uniforms.uFlowFieldInfluence, {
                value: 0,
                duration: 4,
                ease: 'power2.out'
            })
            .to(this.gpgpu.variable.material.uniforms.uFlowFieldStrength, {
                value: 0,
                duration: 4,
                ease: 'power2.out'
            }, "<")
            .to(this.gpgpu.variable.material.uniforms.uFlowFieldFrequency, {
                value: 0,
                duration: 4,
                ease: 'power2.out'
            }, "<")
    }

    replaceGeometry(model) {
        const positions = []
        const uvs = []
        
        model.traverse((child) => {
            if (!child.isMesh) return
            const geo = child.geometry.clone()
            geo.applyMatrix4(child.matrixWorld)
            const pos = geo.getAttribute('position')
            const uv = geo.getAttribute('uv')
            
            for (let i = 0; i < pos.count; i++) {
                positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
            }
            
            if (uv) {
                for (let i = 0; i < uv.count; i++) {
                    uvs.push(uv.getX(i), uv.getY(i))
                }
            }
        })

        const maxParticles = this.gpgpu.size * this.gpgpu.size
        const newCount = Math.min(positions.length / 3, maxParticles)

        // Remplissage complet du buffer baseTexture
        for (let i = 0; i < maxParticles; i++) {
            const i3 = i * 3
            const i4 = i * 4
            if (i < newCount) {
                this.gpgpu.baseTexture.image.data[i4 + 0] = positions[i3 + 0]
                this.gpgpu.baseTexture.image.data[i4 + 1] = positions[i3 + 1]
                this.gpgpu.baseTexture.image.data[i4 + 2] = positions[i3 + 2]
            } else {
                // Remplir le reste avec positions proches de zéro (ou random)
                this.gpgpu.baseTexture.image.data[i4 + 0] = 0
                this.gpgpu.baseTexture.image.data[i4 + 1] = 0
                this.gpgpu.baseTexture.image.data[i4 + 2] = 0
            }
            this.gpgpu.baseTexture.image.data[i4 + 3] = Math.random()
        }

        this.gpgpu.baseTexture.needsUpdate = true
        
        // Update UV attribute with new model's UVs
        if (uvs.length > 0) {
            const maxUvs = maxParticles * 2
            const newUvArray = new Float32Array(maxUvs)
            
            // Fill with new model UVs
            for (let i = 0; i < Math.min(uvs.length, maxUvs); i++) {
                newUvArray[i] = uvs[i]
            }
            
            // Remove old attribute and add new one
            this.particles.geometry.deleteAttribute('aUv')
            this.particles.geometry.setAttribute('aUv', new THREE.BufferAttribute(newUvArray, 2))
        }
        
        // Update texture from the new model
        const newTexture = this.findTexture(model) || this.mapTexture
        this.mapTexture = newTexture
        this.particles.material.uniforms.uModelTexture.value = newTexture
        
        // Update draw range
        this.particles.geometry.setDrawRange(0, newCount)

        console.log('Transition to model → particles:', newCount)
    }


    /* ---------------- UPDATE ---------------- */

    update(elapsedTime, deltaTime) {
        this.gpgpu.variable.material.uniforms.uTime.value = elapsedTime
        this.gpgpu.variable.material.uniforms.uDeltaTime.value = deltaTime

        this.gpgpu.computation.compute()

        this.particles.material.uniforms.uParticlesTexture.value =
            this.gpgpu.computation.getCurrentRenderTarget(this.gpgpu.variable).texture
    }

    /* ---------------- RESIZE ---------------- */

    setupResize() {
        this.sizes.on('resize', () => {
            this.particles.material.uniforms.uResolution.value.set(
                this.sizes.width * this.sizes.pixelRatio,
                this.sizes.height * this.sizes.pixelRatio
            )
        })
    }

    /* ---------------- DEBUG ---------------- */

    setupDebug() {
        this.debugFolder
            .add(this.debugObject, 'uSize', 0, 1, 0.001)
            .onChange(() => {
                this.particles.material.uniforms.uSize.value = this.debugObject.uSize
            })

        this.debugFolder
            .add(this.gpgpu.variable.material.uniforms.uFlowFieldInfluence, 'value', 0, 1, 0.001)
            .name('Flow Influence')

        this.debugFolder
            .add(this.gpgpu.variable.material.uniforms.uFlowFieldStrength, 'value', 0, 10, 0.001)
            .name('Flow Strength')

        this.debugFolder
            .add(this.gpgpu.variable.material.uniforms.uFlowFieldFrequency, 'value', 0, 1, 0.001)
            .name('Flow Frequency')
    }
}
