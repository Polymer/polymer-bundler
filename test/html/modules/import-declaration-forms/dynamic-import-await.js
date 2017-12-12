export async function dynamicExample() {
  const moduleC = await import('../module-c.js');
  console.log(moduleC.value);
}
