const svgNamespace = 'http://www.w3.org/2000/svg';

export function icon(name) {
  const image = document.createElementNS(svgNamespace, 'svg');
  image.classList.add('icon');
  image.setAttribute('aria-hidden', 'true');
  image.setAttribute('focusable', 'false');
  const use = document.createElementNS(svgNamespace, 'use');
  use.setAttribute('href', '/brand/ui.svg#' + name);
  image.append(use);
  return image;
}

document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#main').focus();
});
