uniform sampler2D uModelTexture;
uniform float uOpacity;

varying vec3 vColor;
varying vec2 vUv;

void main()
{
    float distanceToCenter = length(gl_PointCoord - 0.5);
    if(distanceToCenter > 0.5)
        discard;
    
    // Conversion sRGB -> Linear puis sortie
    vec4 textureColor = texture2D(uModelTexture, vUv);

    gl_FragColor = vec4(textureColor.rgb, uOpacity);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}