uniform sampler2D uModelTexture;

varying vec3 vColor;
varying vec2 vUv;

void main()
{
    float distanceToCenter = length(gl_PointCoord - 0.5);
    if(distanceToCenter > 0.5)
        discard;
    
    vec4 textureColor = texture2D(uModelTexture, vUv);
    gl_FragColor = vec4(textureColor.rgb, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}