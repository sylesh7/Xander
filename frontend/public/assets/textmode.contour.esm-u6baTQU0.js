var e=`textmode.contour.js`,t=`0.1.0`,n=`contour`,r=`-/|\\-/|\\`,i={characters:r,threshold:.12,colorSensitivity:.75},a=new WeakMap;function o(e){let t=a.get(e);return t||(t={...i},a.set(e,t)),t}function s(e,t){if(function(e,t){if(typeof e!=`number`||Number.isNaN(e)||!Number.isFinite(e))throw TypeError(`[textmode.contour.js] ${t} must be a finite number.`)}(e,t),e<0||e>1)throw RangeError(`[textmode.contour.js] ${t} must be between 0 and 1.`);return e}function c(e){return e.conversionMode(n)}function l(e){let{source:t}=e,n=e.createBaseUniforms();(function(e){e.u_brightnessStart===void 0&&(e.u_brightnessStart=0),e.u_brightnessEnd===void 0&&(e.u_brightnessEnd=1)})(n);let r=function(e){let t=o(e.source),n=function(e){return e.pass?.options??{}}(e);return{...t,threshold:n.threshold===void 0?t.threshold:s(n.threshold,`options.threshold`),colorSensitivity:n.colorSensitivity===void 0?t.colorSensitivity:s(n.colorSensitivity,`options.colorSensitivity`)}}(e);return Object.assign(n,{u_contourThreshold:r.threshold,u_contourColorSensitivity:r.colorSensitivity,u_imageCellDimensions:[t.width,t.height]}),n}var u={name:e,version:t,async install(e,t){let r=t;r.extendSource(`contourThreshold`,function(e){return o(this).threshold=s(e,`contourThreshold`),c(this)}),r.extendSource(`contourColorSensitivity`,function(e){return o(this).colorSensitivity=s(e,`contourColorSensitivity`),c(this)});let i=await e.createFilterShader(`#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_worldPosition;

uniform sampler2D u_image;
uniform bool u_invert;
uniform bool u_flipX;
uniform bool u_flipY;
uniform float u_charRotation;
uniform float u_brightnessStart;
uniform float u_brightnessEnd;
uniform bool u_charColorFixed;
uniform vec4 u_charColor;
uniform bool u_cellColorFixed;
uniform vec4 u_cellColor;
uniform vec4 u_backgroundColor;
uniform int u_charCount;
uniform sampler2D u_charPaletteTexture;
uniform ivec2 u_charPaletteDimensions;
uniform float u_contourThreshold;
uniform float u_contourColorSensitivity;
uniform vec2 u_imageCellDimensions;
uniform bool u_tmUseLighting;
uniform vec3 u_tmAmbientLightColor;
uniform int u_tmPointLightCount;
uniform vec3 u_tmPointLightPositions[5];
uniform vec3 u_tmPointLightColors[5];
uniform vec3 u_tmLightFalloff;

layout(location = 0) out vec4 o_character;
layout(location = 1) out vec4 o_primaryColor;
layout(location = 2) out vec4 o_secondaryColor;
layout(location = 3) out vec4 o_statePayload;

const float ALPHA_EPSILON = 0.01;
const float EPSILON = 0.000001;
const int TM_MAX_POINT_LIGHTS = 5;

float luminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
}

vec4 sampleSource(vec2 uv) {
    return texture(u_image, clamp(uv, 0.0, 1.0));
}

vec3 fetchCharPaletteColor(int index) {
    int columns = max(u_charPaletteDimensions.x, 1);
    int y = index / columns;
    int x = index % columns;
    return texelFetch(u_charPaletteTexture, ivec2(x, y), 0).rgb;
}

int orientationBin(vec2 normal) {
    // The scalar field returns the contour normal. Directional edge glyphs
    // represent the visible edge tangent, so swap components to rotate by 90deg.
    // The image texture Y axis is opposite screen/glyph Y after the source UV flip,
    // so invert normal.y for orientation binning.
    float angle = degrees(atan(normal.x, -normal.y));

    if(angle >= -22.5 && angle < 22.5) return 0;
    if(angle >= 22.5 && angle < 67.5) return 1;
    if(angle >= 67.5 && angle < 112.5) return 2;
    if(angle >= 112.5 && angle < 157.5) return 3;
    if(angle >= 157.5 || angle < -157.5) return 4;
    if(angle >= -157.5 && angle < -112.5) return 5;
    if(angle >= -112.5 && angle < -67.5) return 6;
    return 7;
}

vec4 scalarVector(vec4 color) {
    vec3 premultipliedColor = color.rgb * color.a;
    return vec4(luminance(premultipliedColor), premultipliedColor.r, premultipliedColor.g, premultipliedColor.b);
}

float scalarComponent(vec4 scalars, float alpha, int component) {
    if(component == 0) return scalars.x;
    if(component == 1) return scalars.y;
    if(component == 2) return scalars.z;
    if(component == 3) return scalars.w;
    return alpha;
}

int strongestScalarComponent(vec4 scalarRange, float alphaRange) {
    int component = 0;
    float bestRange = scalarRange.x;
    float colorRange = max(max(scalarRange.y, scalarRange.z), scalarRange.w) * u_contourColorSensitivity;

    if(colorRange > bestRange) {
        bestRange = colorRange;
        component = scalarRange.y >= scalarRange.z && scalarRange.y >= scalarRange.w ? 1 : scalarRange.z >= scalarRange.w ? 2 : 3;
    }
    if(alphaRange > bestRange) {
        component = 4;
    }

    return component;
}

float selectedScalarRange(vec4 scalarRange, float alphaRange, int component) {
    if(component == 0) return scalarRange.x;
    if(component == 1) return scalarRange.y * u_contourColorSensitivity;
    if(component == 2) return scalarRange.z * u_contourColorSensitivity;
    if(component == 3) return scalarRange.w * u_contourColorSensitivity;
    return alphaRange;
}

vec3 tmComputeGeometricNormal(vec3 worldPosition) {
    vec3 normal = cross(dFdy(worldPosition), dFdx(worldPosition));
    float normalLength = length(normal);
    if(normalLength <= 0.000001) {
        return vec3(0.0, 0.0, 1.0);
    }
    return normal / normalLength;
}

vec3 tmApplyLighting(vec3 baseColor, vec3 worldPosition) {
    if(!u_tmUseLighting) {
        return baseColor;
    }

    vec3 litColor = baseColor * u_tmAmbientLightColor;

    if(u_tmPointLightCount > 0) {
        vec3 normal = tmComputeGeometricNormal(worldPosition);

        for(int i = 0; i < TM_MAX_POINT_LIGHTS; i++) {
            if(i >= u_tmPointLightCount) {
                break;
            }

            vec3 toLight = u_tmPointLightPositions[i] - worldPosition;
            float distanceToLight = length(toLight);
            vec3 lightDirection = distanceToLight > 0.000001 ? toLight / distanceToLight : normal;
            float diffuse = max(dot(normal, lightDirection), 0.0);

            float attenuationDenominator =
                u_tmLightFalloff.x + distanceToLight * u_tmLightFalloff.y + distanceToLight * distanceToLight * u_tmLightFalloff.z;
            float attenuation = attenuationDenominator > 0.0 ? 1.0 / attenuationDenominator : 1.0;
            litColor += baseColor * u_tmPointLightColors[i] * (diffuse * attenuation);
        }
    }

    return clamp(litColor, 0.0, 1.0);
}

void main() {
    if(u_charCount <= 0) {
        discard;
    }

    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
    vec2 cellCounts = max(u_imageCellDimensions, vec2(1.0));
    vec2 cellUvSize = vec2(abs(dFdx(uv.x)) + abs(dFdy(uv.x)), abs(dFdx(uv.y)) + abs(dFdy(uv.y)));
    if(cellUvSize.x <= EPSILON || cellUvSize.y <= EPSILON) {
        cellUvSize = 1.0 / cellCounts;
    }
    vec2 cellMin = clamp(uv - cellUvSize * 0.5, 0.0, 1.0);
    vec2 cellMax = clamp(uv + cellUvSize * 0.5, 0.0, 1.0);
    vec4 topLeft = sampleSource(vec2(cellMin.x, cellMin.y));
    vec4 topRight = sampleSource(vec2(cellMax.x, cellMin.y));
    vec4 bottomRight = sampleSource(vec2(cellMax.x, cellMax.y));
    vec4 bottomLeft = sampleSource(vec2(cellMin.x, cellMax.y));
    vec4 center = sampleSource((cellMin + cellMax) * 0.5);

    vec4 scalarTopLeft = scalarVector(topLeft);
    vec4 scalarTopRight = scalarVector(topRight);
    vec4 scalarBottomRight = scalarVector(bottomRight);
    vec4 scalarBottomLeft = scalarVector(bottomLeft);
    vec4 scalarMin = min(min(scalarTopLeft, scalarTopRight), min(scalarBottomRight, scalarBottomLeft));
    vec4 scalarMax = max(max(scalarTopLeft, scalarTopRight), max(scalarBottomRight, scalarBottomLeft));
    vec4 scalarRange = scalarMax - scalarMin;
    float alphaMin = min(min(topLeft.a, topRight.a), min(bottomRight.a, bottomLeft.a));
    float alphaMax = max(max(topLeft.a, topRight.a), max(bottomRight.a, bottomLeft.a));
    float alphaRange = alphaMax - alphaMin;
    int scalarComponentIndex = strongestScalarComponent(scalarRange, alphaRange);
    float edgeStrength = selectedScalarRange(scalarRange, alphaRange, scalarComponentIndex);

    float avgBrightness = (luminance(topLeft.rgb) + luminance(topRight.rgb) + luminance(bottomRight.rgb) + luminance(bottomLeft.rgb) + luminance(center.rgb)) * 0.2;
    if(avgBrightness < u_brightnessStart || avgBrightness > u_brightnessEnd) {
        discard;
    }

    if(center.a <= ALPHA_EPSILON && alphaMax <= ALPHA_EPSILON) {
        discard;
    }

    if(edgeStrength <= u_contourThreshold) {
        discard;
    }

    float v0 = scalarComponent(scalarTopLeft, topLeft.a, scalarComponentIndex);
    float v1 = scalarComponent(scalarTopRight, topRight.a, scalarComponentIndex);
    float v2 = scalarComponent(scalarBottomRight, bottomRight.a, scalarComponentIndex);
    float v3 = scalarComponent(scalarBottomLeft, bottomLeft.a, scalarComponentIndex);
    float isoValue = (min(min(v0, v1), min(v2, v3)) + max(max(v0, v1), max(v2, v3))) * 0.5;

    bool high0 = v0 >= isoValue;
    bool high1 = v1 >= isoValue;
    bool high2 = v2 >= isoValue;
    bool high3 = v3 >= isoValue;
    int crossingCount = int(high0 != high1) + int(high1 != high2) + int(high2 != high3) + int(high3 != high0);
    if(crossingCount <= 0) {
        discard;
    }

    vec2 normal = vec2((v1 + v2) - (v0 + v3), (v2 + v3) - (v0 + v1));
    float normalLength = length(normal);
    if(normalLength <= EPSILON) {
        discard;
    }
    normal /= normalLength;

    int bestBin = orientationBin(normal);
    int paletteIndex = bestBin;
    if(u_charCount > 0) {
        paletteIndex = bestBin - (bestBin / u_charCount) * u_charCount;
    }
    vec2 encodedIndex = fetchCharPaletteColor(paletteIndex).xy;

    vec3 sampledColor = (topLeft.rgb * topLeft.a + topRight.rgb * topRight.a + bottomRight.rgb * bottomRight.a + bottomLeft.rgb * bottomLeft.a + center.rgb * center.a) /
        max(topLeft.a + topRight.a + bottomRight.a + bottomLeft.a + center.a, EPSILON);
    vec4 charCol = u_charColorFixed ? u_charColor : vec4(sampledColor, 1.0);
    vec4 cellCol = u_cellColorFixed ? u_cellColor : vec4(sampledColor, 1.0);

    vec3 litCharColor = tmApplyLighting(charCol.rgb, v_worldPosition);
    vec3 litCellColor = tmApplyLighting(cellCol.rgb, v_worldPosition);
    o_primaryColor = vec4(litCharColor, charCol.a);
    o_secondaryColor = vec4(litCellColor, cellCol.a);
    o_statePayload = vec4(0.0);

    int invertFlag = int(u_invert ? 1 : 0);
    int flipXFlag = int(u_flipX ? 1 : 0);
    int flipYFlag = int(u_flipY ? 1 : 0);
    float packedFlags = float(invertFlag | (flipXFlag << 1) | (flipYFlag << 2)) / 255.0;

    o_character = vec4(encodedIndex, packedFlags, clamp(u_charRotation, 0.0, 1.0));
}
`);e.conversions.register(function(e){return{id:n,createShader:()=>e,createUniforms:l}}(i))},uninstall(e,t){let r=t;r.removeSourceExtension(`contourThreshold`),r.removeSourceExtension(`contourColorSensitivity`),e.conversions.unregister(n)}};typeof window<`u`&&(window.ContourConversionPlugin=u);export{n as CONTOUR_CONVERSION_MODE,r as CONTOUR_DEFAULT_CHARACTERS,i as CONTOUR_DEFAULT_OPTIONS,u as ContourConversionPlugin};