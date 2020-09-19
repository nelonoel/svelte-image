# Svelte Image

[Demo](https://svelte-image.matyunya.now.sh/)

Svelte image is a preprocessor which automates image optimization using [sharp](https://github.com/lovell/sharp).

It parses your `img` tags, optimizes or inlines them and replaces src accordingly. (External images are not optimized.)

`Image` component enables lazyloading and serving multiple sizes via `srcset`.

This package is heavily inspired by [gatsby image](https://www.gatsbyjs.org/packages/gatsby-image/).

Kudos to [@jkdoshi](https://github.com/jkdoshi) for great [video tutorial](https://www.youtube.com/watch?v=FKNc9A8u2oE) to Svelte Image.

## Installation

```bash
yarn add svelte-image -D
```

`svelte-image` needs to be added as `dev` dependency as Svelte [requires original component source](https://github.com/sveltejs/sapper-template#using-external-components)

In your `rollup.config.js` add `image` to preprocess section:

```js
import image from "svelte-image";


svelte({
  preprocess: {
    ...image(),
  }
})
```

And have fun!

```html
<script>
  import Image from "svelte-image";
</script>

<Image src="fuji.jpg">
```

Will generate

```html
<img
  src="data:image/png;base64,/9j/2wBDAAYEBQYFBAYG...BwYIChAKCgkJChQODwwQF"
  alt="fuji">
<img
  alt="fuji"
  sizes="(max-width: 1000px) 100vw, 1000px"
  srcset="g/400-fuji.jpg 375w, g/800-fuji.jpg 768w, g/1200-fuji.jpg 1024w"
>
```

## Image path

Please note that the library works only with relative paths in Sapper at the moment.
`<Image src="images/fuji.jpg">` works whereas `<Image src="/images/fuji.jpg">` doesn't.

### Svelte + Rollup

To use without Sapper, the generated `static/g` folder needs to be copied to the `public` folder. Use [rollup-plugin-copy](https://www.npmjs.com/package/rollup-plugin-copy) in `rollup.config.js`:

```js
import svelte from 'rollup-plugin-svelte'
import image from 'svelte-image'
import copy from 'rollup-plugin-copy'

export default {
  ...
  plugins: [
    ...
    svelte({
      ...
      preprocess: {
        ...image({...})
      }
    }),
    copy({
      targets: [{ src: 'static/g', dest: 'public' }],
    }),
  ]
}
```

## Configuration and defaults

Image accepts following configuration object:

```js
const defaults = {
  optimizeAll: true, // optimize all images discovered in img tags

  // Case insensitive. Only files whose extension exist in this array will be
  // processed by the <img> tag (assuming `optimizeAll` above is true). Empty
  // the array to allow all extensions to be processed. However, only jpegs and
  // pngs are explicitly supported.
  imgTagExtensions: ['jpg', 'jpeg', 'png'],

  // Same as the above, except that this array applies to the Image Component.
  // If the images passed to your image component are unknown, it might be a
  // good idea to populate this array.
  componentExtensions: [],

  inlineBelow: 10000, // inline all images in img tags below 10kb

  compressionLevel: 8, // png quality level

  quality: 70, // jpeg/webp quality level

  tagName: "Image", // default component name

  sizes: [400, 800, 1200], // array of sizes for srcset in pixels

  // array of screen size breakpoints at which sizes above will be applied
  breakpoints: [375, 768, 1024],

  // source directory that contain the original images
  sourceDir: "./src/",

  // should be ./static for Sapper and ./public for plain Svelte projects
  publicDir: "./static/",

  // a directory within publicDir that will contain the processed images
  outputDir: "g/",

  placeholder: "trace", // or "blur",

  // WebP options [sharp docs](https://sharp.pixelplumbing.com/en/stable/api-output/#webp)
  webpOptions: {
    quality: 75,
    lossless: false,
    force: true
  },

  webp: true,

  // Potrace options for SVG placeholder
  trace: {
    background: "#fff",
    color: "#002fa7",
    threshold: 120
  }

  // Wheter to download and optimize remote images loaded from a url
  optimizeRemote: true,
};
```

## Image component props

Standard image tag props.

- `class` *default: ""*
- `alt` *default: ""*
- `width` *default: ""*
- `height` *default: ""*

- `c` *default: ""* Class string // deprecated in favor of `class`
- `wrapperClass` *default: ""* Classes passed to Waypoint wrapper
- `placeholderClass` *default: ""* Classes passed to placeholder
- `threshold` *default: 1.0* "A threshold of 1.0 means that when 100% of the target is visible within the element specified by the root option, the callback is invoked."
- `lazy` *default: true* Disables Waypoint.

Following props are filled by preprocessor:

- `src` *default: ""*
- `srcset` *default: ""*
- `srcsetWebp` *default: ""*
- `ratio` *default: "100%"*
- `blur` *default: false*
- `sizes` *default: "(max-width: 1000px) 100vw, 1000px"*

## Features

- [x] Generate and add responsive images
- [x] Set base64 placeholder
- [x] Optimize normal images using `img` tag
- [x] Image lazy loading
- [x] Optional SVG trace placeholder
- [x] Support WebP
- [ ] Optimize background or whatever images found in CSS
- [ ] Resolve imported images (only works with string pathnames at the moment)

## Development

Run `yarn && yarn dev` in the `/dev` directory. This is the source code of [demo](https://svelte-image.matyunya.now.sh/) homepage.

## Testing

You can test the preprocessor via `yarn test`. We are using Jest for that, so you can also pass a `--watch` flag to test while developing.

Currently, the best way to test the Svelte component is by using it in a separate project and using yarn/npm link. The dev directory tends to have issues keeping in sync with changes to the src in the root of the repo.