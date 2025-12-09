import Experience from '../Experience.js'
import Environment from './Environment.js'
import RueTiquetone from './RueTiquetoneModel.js'
import ParticlesSystem from './ParticleSystem.js'

export default class World
{
    constructor()
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.resources = this.experience.resources
        this.debug = this.experience.debug
        this.time = this.experience.time
        this.renderer = this.experience.renderer.instance
        this.sizes = this.experience.sizes

        this.resources.on('ready', () =>
        {
            // Setup
            this.setupParticlesSystem()
            // this.rueTiquetone = new RueTiquetone();
            this.environment = new Environment()
        })
    }

    setupParticlesSystem() {
        this.resourceCouloir = this.resources.items.couloirModel
        this.resourceKevin = this.resources.items.kevinModel

        console.log(this.resourceKevin)

        this.couloirParticleSystem = new ParticlesSystem({
            scene: this.scene,
            renderer: this.renderer,
            sizes: this.sizes,
            model: [this.resourceKevin.scene, this.resourceCouloir.scene],
            multiplier: 2,
            debugFolder: this.debug.active ? this.debug.ui.addFolder('Chatelet Particles') : null,
            clearColor: '#4a4a4a',
            uSize: 0.07
        })

    }   

    update()
    {
        let elapsedTime = this.time.clock.getElapsedTime()
        let deltaTime = elapsedTime - this.previousTime
        this.previousTime = elapsedTime

        if (this.couloirParticleSystem) {
            this.couloirParticleSystem.update(elapsedTime, deltaTime)
        }
    }
}