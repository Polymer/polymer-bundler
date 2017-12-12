export function jumpOver(something) {
  import('./dog.js').then((dog) => {
    const lazyDog = new dog.Dog();
    console.log(`${something} jumped over the lazy dog.`);
    console.log(lazyDog.speak());
  });
}
