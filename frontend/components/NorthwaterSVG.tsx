import NorthwaterCanvas from './NorthwaterCanvas'

type Variant = 'hero' | 'mouth'

export default function NorthwaterSVG({ variant }: { variant: Variant }) {
  if (variant === 'hero') {
    return (
      <div className="northwater northwater--hero northwater--live" aria-hidden="true" data-northwater="" data-northwater-variant="hero">
        <svg
          className="northwater__bed"
          viewBox="0 0 1440 260"
          preserveAspectRatio="none"
          focusable={false}
        >
          <path
            className="northwater__water"
            d="M0 94C122 68 214 126 338 105C446 87 531 66 646 88C761 111 840 151 960 124C1078 96 1161 70 1277 90C1354 103 1406 106 1440 98V260H0Z"
          />
          <g className="northwater__resting-current">
            <path d="M-40 129C76 101 189 152 331 130C457 110 533 92 657 114C774 135 851 175 970 149C1089 122 1176 100 1285 116C1362 127 1425 128 1480 122" />
            <path d="M-40 164C75 139 182 181 337 160C463 142 548 119 663 143C778 167 858 204 978 180C1095 155 1179 130 1292 148C1371 160 1430 161 1480 155" />
            <path d="M-40 205C80 181 182 216 341 197C470 181 550 157 668 181C780 204 863 239 984 216C1102 192 1188 166 1297 184C1374 196 1434 197 1480 191" />
          </g>
          <path
            className="northwater__shore"
            d="M0 94C122 68 214 126 338 105C446 87 531 66 646 88C761 111 840 151 960 124C1078 96 1161 70 1277 90C1354 103 1406 106 1440 98"
          />
        </svg>
        <NorthwaterCanvas />
      </div>
    )
  }

  return (
    <div className="northwater northwater--mouth" aria-hidden="true">
      <svg
        className="northwater__bed"
        viewBox="0 0 1440 138"
        preserveAspectRatio="none"
        focusable={false}
      >
        <path
          className="northwater__water"
          d="M0 57C113 48 198 78 319 67C422 58 503 45 615 57C727 70 809 97 927 81C1032 67 1124 45 1239 57C1325 66 1389 73 1440 64V138H0Z"
        />
        <g className="northwater__resting-current">
          <path d="M-40 80C76 69 176 94 305 83C424 72 509 61 628 74C744 87 819 111 939 95C1045 81 1134 65 1250 75C1346 83 1414 89 1480 82" />
          <path d="M-40 100C73 90 184 111 310 102C429 93 509 79 634 93C751 108 829 132 945 114C1057 98 1145 81 1256 94C1344 104 1417 110 1480 104" />
          <path d="M-40 120C74 111 177 127 311 120C437 113 525 97 640 112C754 126 837 144 950 132C1062 119 1149 103 1260 113C1350 123 1420 128 1480 123" />
        </g>
        <path
          className="northwater__shore"
          d="M0 57C113 48 198 78 319 67C422 58 503 45 615 57C727 70 809 97 927 81C1032 67 1124 45 1239 57C1325 66 1389 73 1440 64"
        />
      </svg>
    </div>
  )
}
