import * as THREE from 'three'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'
import gpgpuParticlesShader from './shaders/gpgpu/particles.glsl'
import particlesFragmentShader from './shaders/particles/fragment.glsl'
import particlesVertexShader from './shaders/particles/vertex.glsl'

export default class ParticlesSystem {
    constructor(config = {}) {
        // Configuration
        this.scene = config.scene
        this.renderer = config.renderer
        this.sizes = config.sizes
        this.models = Array.isArray(config.model) ? config.model : [config.model] // Soit c'est un tableau, soit un model
        this.multiplier = config.multiplier || 2
        this.debugFolder = config.debugFolder || null

        // Données internes
        this.baseGeometry = {}
        this.gpgpu = {}
        this.particles = {}
        this.mapTexture = null
        this.maxParticles = 0
        this.previousTime = 0

        // Debug object
        this.debugObject = {
            clearColor: config.clearColor || '#4a4a4a',
            particlesCount: 0,
            uSize: config.uSize || 0.07,
            uFlowFieldInfluence: 0,
            uFlowFieldStrength: 0,
            uFlowFieldFrequency: 0
        }

        // Master arrays
        this.masterParticlesUvArray = null
        this.masterSizesArray = null

        this.init()
    }

    init() {
        this.setupMultipleGeometries()
        this.setupGPUCompute()
        this.setupParticles()
        if (this.debugFolder) {
            this.setupDebug()
        }
        this.setupEventListeners()
    }

    setupMultipleGeometries() {
        const allGeometries = []
        const allMaterials = []

        this.models.map((model) => {
            model.traverse((child) => {
                if (child.isMesh) {
                    let geometry = child.geometry.clone()
                    geometry.applyMatrix4(child.matrixWorld)
                    allGeometries.push(geometry)

                    if (child.material && !allMaterials.includes(child.material)) {
                        console.log("material child ::", child.material)
                        allMaterials.push(child.material)
                    }
                }
            })
        })

        console.log(`${allGeometries.length} meshes trouvés`)
        console.log(`${allMaterials.length} materials trouvés`)

        this.mergeGeometries(allGeometries)
        this.extractTexture(allMaterials)
    }

    mergeGeometries(allGeometries) {
        const mergedGeometry = new THREE.BufferGeometry()
        const positions = []
        const uvs = []

        allGeometries.forEach((geometry) => {
            const positionAttribute = geometry.getAttribute('position')
            const uvAttribute = geometry.getAttribute('uv')

            if (positionAttribute) {
                for (let i = 0; i < positionAttribute.count; i++) {
                    positions.push(
                        positionAttribute.getX(i),
                        positionAttribute.getY(i),
                        positionAttribute.getZ(i)
                    )
                }
            }

            if (uvAttribute) {
                for (let i = 0; i < uvAttribute.count; i++) {
                    uvs.push(uvAttribute.getX(i), uvAttribute.getY(i))
                }
            }
        })

        mergedGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
        if (uvs.length > 0) {
            mergedGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2))
        }

        this.baseGeometry.instance = mergedGeometry
        this.baseGeometry.count = mergedGeometry.attributes.position.count

        console.log(`Géométrie fusionnée : ${this.baseGeometry.count} vertices`)
    }

    extractTexture(allMaterials) {
        this.mapTexture = null
        for (let material of allMaterials) {
            console.log(material.map && !this.mapTexture)
            if (material.map && !this.mapTexture) {
                this.mapTexture = material.map
                break
            }
        }

        console.log("final mapTexture ::", this.mapTexture)

        if (!this.mapTexture) {
            console.warn("Aucune texture trouvée, création d'une texture blanche par défaut.")
            const data = new Uint8Array([255, 255, 255, 255])
            this.mapTexture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
            this.mapTexture.needsUpdate = true
        }
    }

    setupGPUCompute() {
        const originalSize = Math.ceil(Math.sqrt(this.baseGeometry.count))
        this.gpgpu.size = originalSize * this.multiplier
        this.gpgpu.computation = new GPUComputationRenderer(this.gpgpu.size, this.gpgpu.size, this.renderer)

        this.gpgpu.baseParticlesTexture = this.gpgpu.computation.createTexture()

        // Remplir avec les points existants
        for (let i = 0; i < this.baseGeometry.count; i++) {
            const i3 = i * 3
            const i4 = i * 4

            this.gpgpu.baseParticlesTexture.image.data[i4 + 0] = this.baseGeometry.instance.attributes.position.array[i3 + 0]
            this.gpgpu.baseParticlesTexture.image.data[i4 + 1] = this.baseGeometry.instance.attributes.position.array[i3 + 1]
            this.gpgpu.baseParticlesTexture.image.data[i4 + 2] = this.baseGeometry.instance.attributes.position.array[i3 + 2]
            this.gpgpu.baseParticlesTexture.image.data[i4 + 3] = Math.random()
        }

        // Remplir le reste avec des points proches
        for (let i = this.baseGeometry.count; i < this.gpgpu.size * this.gpgpu.size; i++) {
            const i3 = (i % this.baseGeometry.count) * 3
            const i4 = i * 4

            this.gpgpu.baseParticlesTexture.image.data[i4 + 0] = this.baseGeometry.instance.attributes.position.array[i3 + 0] + (Math.random() - 0.5) * 0.1
            this.gpgpu.baseParticlesTexture.image.data[i4 + 1] = this.baseGeometry.instance.attributes.position.array[i3 + 1] + (Math.random() - 0.5) * 0.1
            this.gpgpu.baseParticlesTexture.image.data[i4 + 2] = this.baseGeometry.instance.attributes.position.array[i3 + 2] + (Math.random() - 0.5) * 0.1
            this.gpgpu.baseParticlesTexture.image.data[i4 + 3] = Math.random()
        }

        this.gpgpu.particlesVariable = this.gpgpu.computation.addVariable('uParticles', gpgpuParticlesShader, this.gpgpu.baseParticlesTexture)
        this.gpgpu.computation.setVariableDependencies(this.gpgpu.particlesVariable, [this.gpgpu.particlesVariable])

        const uniforms = this.gpgpu.particlesVariable.material.uniforms
        uniforms.uTime = new THREE.Uniform(0)
        uniforms.uDeltaTime = new THREE.Uniform(0)
        uniforms.uBase = new THREE.Uniform(this.gpgpu.baseParticlesTexture)
        uniforms.uFlowFieldInfluence = new THREE.Uniform(this.debugObject.uFlowFieldInfluence)
        uniforms.uFlowFieldStrength = new THREE.Uniform(this.debugObject.uFlowFieldStrength)
        uniforms.uFlowFieldFrequency = new THREE.Uniform(this.debugObject.uFlowFieldFrequency)

        const error = this.gpgpu.computation.init()
        if (error !== null) {
            console.error('GPU Compute initialization error:', error)
        }
    }

    setupParticles() {
        this.maxParticles = this.gpgpu.size * this.gpgpu.size
        this.debugObject.particlesCount = this.baseGeometry.count

        this.setupMasterUVs()
        this.setupMasterSizes()
        this.updateParticles()
    }

    setupMasterUVs() {
        this.masterParticlesUvArray = new Float32Array(this.maxParticles * 2)
        for (let y = 0; y < this.gpgpu.size; y++) {
            for (let x = 0; x < this.gpgpu.size; x++) {
                const i = y * this.gpgpu.size + x
                if (i >= this.maxParticles) break

                const i2 = i * 2
                const uvX = (x + 0.5) / this.gpgpu.size
                const uvY = (y + 0.5) / this.gpgpu.size
                this.masterParticlesUvArray[i2 + 0] = uvX
                this.masterParticlesUvArray[i2 + 1] = uvY
            }
        }
    }

    setupMasterSizes() {
        this.masterSizesArray = new Float32Array(this.maxParticles)
        for (let i = 0; i < this.maxParticles; i++) {
            this.masterSizesArray[i] = Math.random()
        }
    }

    updateParticles() {
        if (this.particles.points) {
            this.particles.geometry.dispose()
            this.particles.material.dispose()
            this.scene.remove(this.particles.points)
        }

        const count = this.debugObject.particlesCount

        this.particles.geometry = new THREE.BufferGeometry()
        this.particles.geometry.setDrawRange(0, count)

        // GPGPU UVs
        this.particles.geometry.setAttribute('aParticlesUv', new THREE.BufferAttribute(this.masterParticlesUvArray.slice(0, count * 2), 2))

        // Random Sizes
        this.particles.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.masterSizesArray.slice(0, count), 1))

        // Model UVs avec wrapping
        if (this.baseGeometry.instance.attributes.uv) {
            const modelUvArray = new Float32Array(count * 2)
            const originalUvArray = this.baseGeometry.instance.attributes.uv.array

            for (let i = 0; i < count; i++) {
                const wrappedIndex = i % this.baseGeometry.count
                const i2 = i * 2
                const wrappedI2 = wrappedIndex * 2

                modelUvArray[i2 + 0] = originalUvArray[wrappedI2 + 0]
                modelUvArray[i2 + 1] = originalUvArray[wrappedI2 + 1]
            }

            this.particles.geometry.setAttribute('aUv', new THREE.BufferAttribute(modelUvArray, 2))
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

    setupDebug() {
        this.debugFolder.addColor(this.debugObject, 'clearColor').onChange(() => {
            // Vous pouvez émettre un événement ou appeler une callback
        })

        this.debugFolder.add(this.debugObject, 'uSize')
            .min(0)
            .max(1)
            .step(0.001)
            .onChange(() => {
                if (this.particles.material) {
                    this.particles.material.uniforms.uSize.value = this.debugObject.uSize
                }
            })

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

        this.debugFolder.add(this.debugObject, 'particlesCount')
            .min(100)
            .max(this.maxParticles)
            .step(100)
            .name('Particle Count')
            .onFinishChange(() => this.updateParticles())
    }

    setupEventListeners() {
        this.sizes.on('resize', () => {
            if (this.particles.material) {
                this.particles.material.uniforms.uResolution.value.set(
                    this.sizes.width * this.sizes.pixelRatio,
                    this.sizes.height * this.sizes.pixelRatio
                )
            }
        })  
    }

    update(elapsedTime, deltaTime) {
        // GPGPU Update
        this.gpgpu.particlesVariable.material.uniforms.uTime.value = elapsedTime
        this.gpgpu.particlesVariable.material.uniforms.uDeltaTime.value = deltaTime
        this.gpgpu.computation.compute()

        // Update position texture
        if (this.particles.material) {
            this.particles.material.uniforms.uParticlesTexture.value = this.gpgpu.computation.getCurrentRenderTarget(this.gpgpu.particlesVariable).texture
        }
    }

    dispose() {
        if (this.particles.points) {
            this.particles.geometry.dispose()
            this.particles.material.dispose()
            this.scene.remove(this.particles.points)
        }
        this.gpgpu.computation.dispose()
    }
}