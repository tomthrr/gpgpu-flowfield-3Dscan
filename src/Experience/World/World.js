import Experience from '../Experience.js'
import Environment from './Environment.js'
import Example from './Example.js'
import RueTiquetone from './RueTiquetoneModel.js'

export default class World
{
    constructor()
    {
        this.experience = new Experience()
        this.scene = this.experience.scene
        this.resources = this.experience.resources

        this.resources.on('ready', () =>
        {
            // Setup
            this.rueTiquetone = new RueTiquetone();
            this.environment = new Environment()
        })
    }

    update()
    {
        if(this.fox)
            this.fox.update();

        if (this.rueTiquetone) 
            this.rueTiquetone.update();
    }
}