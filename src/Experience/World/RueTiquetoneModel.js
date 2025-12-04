import * as THREE from 'three'
import Experience from '../Experience'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'

import gpgpuParticlesShader from './shaders/gpgpu/particles.glsl'
import particlesFragmentShader from './shaders/particles/fragment.glsl'
import particlesVertexShader from './shaders/particles/vertex.glsl'

export default class RueTiquetonne
{
    constructor()
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.resources = this.experience.resources
        this.time = this.experience.time
        this.renderer = this.experience.renderer.instance
        this.sizes = this.experience.sizes
        this.debug = this.experience.debug

        this.resource = this.resources.items.couloirModel

        // Debug
        if(this.debug.active)
        {
            this.debugFolder = this.debug.ui.addFolder('RueTiquetonne')
        }

        // Initialize data structures
        this.baseGeometry = {}
        this.gpgpu = {}
        this.particles = {}
        this.debugObject = {
            clearColor: '#29191f',
            particlesCount: 0,
            uSize: 0.07
        }

        // Master arrays for optimization
        this.masterParticlesUvArray = null
        this.masterSizesArray = null
        this.mapTexture = null

        this.setModel()
        this.setupGeometry()
        this.setupGPUCompute()
        this.setupParticles()
        this.setupDebug()
        this.setupEventListeners()
    }

    setModel()
    {
        this.model = this.resource.scene
        // this.scene.add(this.model)
    }

    setupGeometry()
    {
        // Intelligently retrieve first available Mesh
        this.mesh = this.model.children.find(child => child.isMesh) || this.model.children[0]
        this.baseGeometry.instance = this.mesh.geometry
        console.log(this.baseGeometry.instance)
        this.baseGeometry.count = this.baseGeometry.instance.attributes.position.count
        console.log(this.baseGeometry.count)

        // Retrieve model texture
        this.mapTexture = null
        this.model.traverse((child) => {
            if (child.isMesh && child.material && !this.mapTexture) {
                if (child.material.map) {
                    this.mapTexture = child.material.map
                }
            }
        })

        // Create default white texture if not found
        if (!this.mapTexture) {
            console.warn("Aucune texture trouvée, création d'une texture blanche par défaut.")
            const data = new Uint8Array([255, 255, 255, 255])
            this.mapTexture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
            this.mapTexture.needsUpdate = true
        }
    }

    setupGPUCompute()
    {
        this.gpgpu.size = Math.ceil(Math.sqrt(this.baseGeometry.count))
        this.gpgpu.computation = new GPUComputationRenderer(this.gpgpu.size, this.gpgpu.size, this.renderer)

        // Store base texture as property to persist it
        this.gpgpu.baseParticlesTexture = this.gpgpu.computation.createTexture()

        for (let i = 0; i < this.baseGeometry.count; i++) {
            const i3 = i * 3
            const i4 = i * 4

            this.gpgpu.baseParticlesTexture.image.data[i4 + 0] = this.baseGeometry.instance.attributes.position.array[i3 + 0]
            this.gpgpu.baseParticlesTexture.image.data[i4 + 1] = this.baseGeometry.instance.attributes.position.array[i3 + 1]
            this.gpgpu.baseParticlesTexture.image.data[i4 + 2] = this.baseGeometry.instance.attributes.position.array[i3 + 2]
            this.gpgpu.baseParticlesTexture.image.data[i4 + 3] = Math.random()
        }

        this.gpgpu.particlesVariable = this.gpgpu.computation.addVariable('uParticles', gpgpuParticlesShader, this.gpgpu.baseParticlesTexture)
        this.gpgpu.computation.setVariableDependencies(this.gpgpu.particlesVariable, [this.gpgpu.particlesVariable])

        const uniforms = this.gpgpu.particlesVariable.material.uniforms
        uniforms.uTime = new THREE.Uniform(0)
        uniforms.uDeltaTime = new THREE.Uniform(0)
        uniforms.uBase = new THREE.Uniform(this.gpgpu.baseParticlesTexture)
        uniforms.uFlowFieldInfluence = new THREE.Uniform(0.5)
        uniforms.uFlowFieldStrength = new THREE.Uniform(2)
        uniforms.uFlowFieldFrequency = new THREE.Uniform(0.5)

        const error = this.gpgpu.computation.init()
        if (error !== null) {
            console.error('GPU Compute initialization error:', error)
        }

        // Debug visualization
        this.gpgpu.debug = new THREE.Mesh(
            new THREE.PlaneGeometry(3, 3),
            new THREE.MeshBasicMaterial({ map: this.gpgpu.computation.getCurrentRenderTarget(this.gpgpu.particlesVariable).texture })
        )
        this.gpgpu.debug.position.x = 3
        this.gpgpu.debug.visible = false
        this.scene.add(this.gpgpu.debug)
    }

    setupParticles()
    {
        this.debugObject.particlesCount = this.baseGeometry.count

        // Pre-calculate Master UVs
        this.masterParticlesUvArray = new Float32Array(this.baseGeometry.count * 2)
        for (let y = 0; y < this.gpgpu.size; y++) {
            for (let x = 0; x < this.gpgpu.size; x++) {
                const i = (y * this.gpgpu.size + x)
                if(i >= this.baseGeometry.count) break
                
                const i2 = i * 2
                const uvX = (x + 0.5) / this.gpgpu.size
                const uvY = (y + 0.5) / this.gpgpu.size
                this.masterParticlesUvArray[i2 + 0] = uvX
                this.masterParticlesUvArray[i2 + 1] = uvY
            }
        }

        // Pre-calculate Master Sizes
        this.masterSizesArray = new Float32Array(this.baseGeometry.count)
        for(let i = 0; i < this.baseGeometry.count; i++) {
            this.masterSizesArray[i] = Math.random()
        }

        this.updateParticles()
    }

    updateParticles()
    {
        // Cleanup old particles
        if (this.particles.points) {
            this.particles.geometry.dispose()
            this.particles.material.dispose()
            this.scene.remove(this.particles.points)
        }

        const count = this.debugObject.particlesCount

        // Geometry
        this.particles.geometry = new THREE.BufferGeometry()
        this.particles.geometry.setDrawRange(0, count)

        // GPGPU UVs
        this.particles.geometry.setAttribute('aParticlesUv', new THREE.BufferAttribute(this.masterParticlesUvArray.slice(0, count * 2), 2))
        
        // Random Sizes
        this.particles.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.masterSizesArray.slice(0, count), 1))

        // Model UVs (for texture)
        if (this.baseGeometry.instance.attributes.uv) {
            const slicedUvs = this.baseGeometry.instance.attributes.uv.array.slice(0, count * 2)
            this.particles.geometry.setAttribute('aUv', new THREE.BufferAttribute(slicedUvs, 2))
        }

        // Material
        this.particles.material = new THREE.ShaderMaterial({
            vertexShader: particlesVertexShader,
            fragmentShader: particlesFragmentShader,
            uniforms: {
                uSize: new THREE.Uniform(this.debugObject.uSize),
                uResolution: new THREE.Uniform(new THREE.Vector2(this.sizes.width * this.sizes.pixelRatio, this.sizes.height * this.sizes.pixelRatio)),
                uParticlesTexture: new THREE.Uniform(),
                uModelTexture: new THREE.Uniform(this.mapTexture)
            }
        })

        // Mesh
        this.particles.points = new THREE.Points(this.particles.geometry, this.particles.material)
        this.scene.add(this.particles.points)
    }

    setupDebug()
    {
        if(!this.debug.active) return

        this.debugFolder.addColor(this.debugObject, 'clearColor').onChange(() => {
            this.renderer.setClearColor(this.debugObject.clearColor)
        })

        this.debugFolder.add(this.debugObject, 'uSize')
            .min(0)
            .max(1)
            .step(0.001)
            .onChange(() => {
                if(this.particles.material) {
                    this.particles.material.uniforms.uSize.value = this.debugObject.uSize
                }
            })

        // GPGPU Controls
        this.debugFolder.add(this.gpgpu.particlesVariable.material.uniforms.uFlowFieldInfluence, 'value')
            .min(0)
            .max(1)
            .step(0.001)
            .name('uFlowfieldInfluence')

        this.debugFolder.add(this.gpgpu.particlesVariable.material.uniforms.uFlowFieldStrength, 'value')
            .min(0)
            .max(10)
            .step(0.001)
            .name('uFlowfieldStrength')

        this.debugFolder.add(this.gpgpu.particlesVariable.material.uniforms.uFlowFieldFrequency, 'value')
            .min(0)
            .max(1)
            .step(0.001)
            .name('uFlowfieldFrequency')

        // Particle count control
        this.debugFolder.add(this.debugObject, 'particlesCount')
            .min(100)
            .max(this.baseGeometry.count)
            .step(100)
            .name('Particle Count')
            .onFinishChange(() => this.updateParticles())
    }

    setupEventListeners()
    {
        this.sizes.on('resize', () => {
            if(this.particles.material) {
                this.particles.material.uniforms.uResolution.value.set(
                    this.sizes.width * this.sizes.pixelRatio,
                    this.sizes.height * this.sizes.pixelRatio
                )
            }
        })
    }

    update()
    {
        const elapsedTime = this.time.elapsed
        const deltaTime = this.time.delta

        // GPGPU Update
        this.gpgpu.particlesVariable.material.uniforms.uTime.value = elapsedTime
        this.gpgpu.particlesVariable.material.uniforms.uDeltaTime.value = deltaTime
        this.gpgpu.computation.compute()
        
        // Update position texture in render shader
        if(this.particles.material) {
            this.particles.material.uniforms.uParticlesTexture.value = this.gpgpu.computation.getCurrentRenderTarget(this.gpgpu.particlesVariable).texture
        }
    }
}