#extension GL_OES_standard_derivatives : enable

precision highp float;

uniform vec2 viewResolution;
uniform vec2 viewOffset;

uniform float hatchAlpha;
uniform sampler2D diffuseMap;
uniform int useDiffuseMap;
uniform int useScreenTintFunc;

varying vec4 vColor;
varying vec2 vUD;

float radialHatch (vec2 coord, float scale, float thickness) {
	float rcoord = length(coord) * scale;
	float line = abs(fract(rcoord - 0.5) - 0.5) / fwidth(rcoord);
	return thickness - min(line, thickness);
}

void main() {
	vec2 fragCoord = gl_FragCoord.xy;
	vec2 fragCenter = fragCoord - viewResolution * 0.5;
	vec2 position = fragCenter - vec2(viewOffset.x, -viewOffset.y);
  vec2 coord = fragCoord / viewResolution;
  vec2 ud = vUD;

  vec3 outColor = vColor.rgb;
  float outAlpha = vColor.a;

  if (useDiffuseMap == 1) {
    outColor *= texture2D(diffuseMap, coord).rgb;
  }

  if (useScreenTintFunc == 1) {
    outColor *= vec3(coord.x, 0.6 - distance(coord, vec2(0.5)), coord.y);
  }

  if (hatchAlpha > 0.0) {
    outAlpha *= mix(1.0, radialHatch(position, 0.1, 3.0), hatchAlpha);
  }

  gl_FragColor = vec4(outColor, outAlpha);
}
