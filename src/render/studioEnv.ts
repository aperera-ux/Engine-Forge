/**
 * Offline studio environment: a small scene of emissive softboxes rendered
 * once through PMREMGenerator.fromScene (no CubeCamera per frame, no HDR fetch).
 */
import * as THREE from 'three';

function softbox(scene: THREE.Scene, color: string, intensity: number, pos: [number, number, number], size: [number, number], lookAt: [number, number, number] = [0, 0, 0], round = false) {
  const geo = round ? new THREE.RingGeometry(size[0] * 0.35, size[0] * 0.5, 48) : new THREE.PlaneGeometry(size[0], size[1]);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide, toneMapped: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.lookAt(...lookAt);
  scene.add(m);
}

export function createStudioEnvironment(gl: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  // dim graded "room" so metals never reflect pure black
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(40, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      toneMapped: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = vP.y*0.5+0.5; vec3 c = mix(vec3(0.035,0.038,0.045), vec3(0.16,0.17,0.19), smoothstep(0.2,0.95,h)); gl_FragColor = vec4(c,1.0); }',
    }),
  );
  scene.add(room);
  softbox(scene, '#ffffff', 3.2, [0, 12, 0], [18, 12]); // overhead
  softbox(scene, '#ffffff', 4.5, [-12, 4, 4], [16, 3.5]); // key strip L
  softbox(scene, '#ffffff', 3.0, [12, 3, -3], [16, 3]); // strip R
  softbox(scene, '#fff6ec', 1.8, [0, 3, 13], [18, 4]); // front fill
  softbox(scene, '#ffffff', 1.4, [0, 5, -13], [18, 5]); // back
  softbox(scene, '#5aaeff', 4, [8, 6, -10], [7, 7], [0, 0, 0], true); // cool rim ring
  softbox(scene, '#ffb37a', 2.0, [-9, 1, -10], [10, 3]); // warm kicker
  const pmrem = new THREE.PMREMGenerator(gl);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}
