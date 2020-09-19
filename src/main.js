const svelte = require("svelte/compiler");
const sharp = require("sharp");
const path = require("path");
const util = require("util");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");

let options = {
  optimizeAll: true, // optimize all images discovered in img tags

  // Case insensitive. Only files whose extension exist in this array will be
  // processed by the <img> tag (assuming `optimizeAll` above is true). Empty
  // the array to allow all extensions to be processed. However, only jpegs and
  // pngs are explicitly supported.
  imgTagExtensions: ["jpg", "jpeg", "png"],

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

  outputDir: "g/",

  publicDir: "./static/",

  sourceDir: "./src/",

  placeholder: "trace", // or "blur",

  // WebP options [sharp docs](https://sharp.pixelplumbing.com/en/stable/api-output/#webp)
  webpOptions: {
    quality: 75,
    lossless: false,
    force: true,
  },

  webp: true,

  // Potrace options for SVG placeholder
  trace: {
    background: "#fff",
    color: "#002fa7",
    threshold: 120,
  },

  // Wheter to download and optimize remote images loaded from a url
  optimizeRemote: true,
};

async function downloadImage(url, folder = ".") {
  const hash = crypto.createHash("sha1").update(url).digest("hex");
  const existing = fs.readdirSync(folder).find((e) => e.startsWith(hash));
  if (existing) {
    return existing;
  }

  const { headers } = await axios.head(url);

  const [type, ext] = headers["content-type"].split("/");
  if (type !== "image") return null;

  const filename = `${hash}.${ext}`;
  const saveTo = path.resolve(folder, filename);

  if (fs.existsSync(path)) return filename;

  const writer = fs.createWriteStream(saveTo);
  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve(filename));
    writer.on("error", reject);
  });
}

function getPathsObject(nodeSrc) {
  const inPath = nodeSrc;
  const outDir = path.resolve(options.publicDir, options.outputDir);
  const filename = path.basename(inPath);
  const outUrl = path.join(options.outputDir, filename);

  return {
    inPath,
    outDir,
    outPath: path.join(outDir, filename),
    outUrl,
    getResizePaths: (size) => {
      const filenameWithSize = getFilenameWithSize(inPath, size);
      return {
        outPath: path.join(outDir, filenameWithSize),
        outUrl: path.join(path.dirname(outUrl), filenameWithSize),
        outPathWebp: path.join(outDir, getWebpFilenameWithSize(inPath, size)),
      };
    },
  };
}

async function getBase64(pathname, inlined = false) {
  let size = 64;

  if (inlined) {
    size = (await sharp(pathname).metadata()).size;
  }

  const s = await sharp(pathname).resize(size).toBuffer();

  return "data:image/png;base64," + s.toString("base64");
}

const optimizeSVG = (svg) => {
  const svgo = require(`svgo`);
  const res = new svgo({
    multipass: true,
    floatPrecision: 0,
    datauri: "base64",
  });

  return res.optimize(svg).then(({ data }) => data);
};

async function getTrace(pathname) {
  const potrace = require("potrace");
  const trace = util.promisify(potrace.trace);

  const s = await sharp(pathname)
    .resize(options.trace.size || 500)
    .toBuffer();

  const res = await trace(s, options.trace);

  return optimizeSVG(res);
}

function getProp(node, attr) {
  const prop = (node.attributes || []).find((a) => a.name === attr);
  return prop ? prop.value : undefined;
}

function getSrc(node) {
  try {
    return getProp(node, "src") || [{}];
  } catch (err) {
    console.log("Was unable to retrieve image src", err);
    return [{}];
  }
}

// Checks beginning of string for double leading slash, or the same preceeded by
// http or https
const IS_EXTERNAL = /^(https?:)?\/\//i;

/**
 * Returns a boolean indicating if the filename has one of the extensions in the
 * array. If the array is empty, all files will be accepted.
 *
 * @param {string} filename the name of the image file to be parsed
 * @param {Array<string>} extensions Either of options.imgTagExtensions or
 * options.componentExtensions
 * @returns {boolean}
 */
function fileHasCorrectExtension(filename, extensions) {
  return extensions.length === 0
    ? true
    : extensions
        .map((x) => x.toLowerCase())
        .includes(filename.split(".").pop().toLowerCase());
}

function willNotProcess(reason) {
  return {
    willNotProcess: true,
    reason,
    paths: undefined,
  };
}

function willProcess(nodeSrc) {
  fs.writeFileSync(
    path.resolve(options.publicDir, options.outputDir, path.basename(nodeSrc)),
    fs.readFileSync(nodeSrc)
  );
  return {
    willNotProcess: false,
    reason: undefined,
    paths: getPathsObject(nodeSrc),
  };
}

async function getProcessingPathsForNode(node, parentDir) {
  const [value] = getSrc(node);

  // dynamic or empty value
  if (value.type === "MustacheTag" || value.type === "AttributeShorthand") {
    return willNotProcess(`Cannot process a dynamic value: ${value.type}`);
  }
  if (!value.data) {
    return willNotProcess("The `src` is blank");
  }
  if (
    node.name === "img" &&
    !fileHasCorrectExtension(value.data, options.imgTagExtensions)
  ) {
    return willNotProcess(
      `The <img> tag was passed a file (${
        value.data
      }) whose extension is not one of ${options.imgTagExtensions.join(", ")}`
    );
  }
  if (
    node.name === options.tagName &&
    !fileHasCorrectExtension(value.data, options.componentExtensions)
  ) {
    return willNotProcess(
      `The ${options.tagName} component was passed a file (${
        value.data
      }) whose extension is not one of ${options.componentExtensions.join(
        ", "
      )}`
    );
  }

  // TODO:
  // resolve imported path
  // refactor externals

  let removedDomainSlash;
  if (IS_EXTERNAL.test(value.data)) {
    if (!options.optimizeRemote) {
      return willNotProcess(`The \`src\` is external: ${value.data}`);
    } else {
      removedDomainSlash = await downloadImage(
        value.data,
        options.sourceDir
      ).catch((e) => {
        console.error(e.toString());

        return null;
      });

      if (removedDomainSlash === null) {
        return willNotProcess(`The url of is not an image: ${value.data}`);
      }
    }
  } else {
    removedDomainSlash = value.data.replace(/^\/([^\/])/, "$1");
  }

  const relativeToParent = path.resolve(parentDir, value.data);
  const relativeToSource = path.resolve(options.sourceDir, value.data);

  if (fs.existsSync(relativeToParent)) {
    return willProcess(relativeToParent);
  }

  if (fs.existsSync(relativeToSource)) {
    return willProcess(relativeToSource);
  }

  return willNotProcess(`The image file does not exist: ${relativeToSource}`);
}

function getBasename(p) {
  return path.basename(p, path.extname(p));
}

function getRelativePath(p) {
  return path.relative(options.sourceDir, p);
}

function getFilenameWithSize(p, size) {
  return `${getBasename(p)}-${size}${path.extname(p)}`;
}

function getWebpFilenameWithSize(p, size) {
  return `${getBasename(p)}-${size}.webp`;
}

function ensureOutDirExists(outDir) {
  mkdirp(path.join(options.sourceDir, getRelativePath(outDir)));
}

function insert(content, value, start, end, offset) {
  return {
    content:
      content.substr(0, start + offset) + value + content.substr(end + offset),
    offset: offset + value.length - (end - start),
  };
}

async function createSizes(paths) {
  const smallestSize = Math.min(...options.sizes);
  const meta = await sharp(paths.inPath).metadata();
  const sizes = smallestSize > meta.width ? [meta.width] : options.sizes;

  return (
    await Promise.all(sizes.map((size) => resize(size, paths, meta)))
  ).filter(Boolean);
}

async function resize(size, paths, meta = null) {
  if (!meta) {
    meta = await sharp(paths.inPath).metadata();
  }
  const { outPath, outUrl, outPathWebp } = paths.getResizePaths(size);

  if (meta.width < size) return null;

  ensureOutDirExists(paths.outDir);

  if (options.webp && !fs.existsSync(outPathWebp)) {
    await sharp(paths.inPath)
      .resize({ width: size, withoutEnlargement: true })
      .webp(options.webpOptions)
      .toFile(outPathWebp);
  }

  if (fs.existsSync(outPath)) {
    return {
      ...meta,
      filename: outUrl,
      size,
    };
  }

  return {
    ...meta,
    ...(await sharp(paths.inPath)
      .resize({ width: size, withoutEnlargement: true })
      .jpeg({
        quality: options.quality,
        progressive: false,
        force: false,
      })
      .png({ compressionLevel: options.compressionLevel, force: false })
      .toFile(outPath)),
    size,
    filename: outUrl,
  };
}

// Pass a string, then it will call itself with an array
function mkdirp(dir) {
  if (typeof dir === "string") {
    if (fs.existsSync(dir)) {
      return dir;
    }
    return mkdirp(dir.split(path.sep));
  }

  return dir.reduce((created, nextPart) => {
    const newDir = path.join(created, nextPart);
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir);
    }
    return newDir;
  }, "");
}

const pathSepPattern = new RegExp("\\" + path.sep, "g");

const srcsetLine = (options) => (s, i) =>
  `${s.filename.replace(pathSepPattern, "/")} ${options.breakpoints[i]}w`;

const srcsetLineWebp = (options) => (s, i) =>
  `${s.filename.replace(pathSepPattern, "/")} ${options.breakpoints[i]}w`
    .replace("jpg", "webp")
    .replace("png", "webp")
    .replace("jpeg", "webp");

function getSrcset(sizes, lineFn = srcsetLine, tag = "srcset") {
  const s = Array.isArray(sizes) ? sizes : [sizes];
  const srcSetValue = s
    .filter((f) => f)
    .map(lineFn(options))
    .join();

  return ` ${tag}=\'${srcSetValue}\' `;
}

async function replaceInComponent(edited, node, parentDir) {
  const { content, offset } = await edited;

  const { paths, willNotProcess, reason } = await getProcessingPathsForNode(
    node,
    parentDir
  );

  if (willNotProcess) {
    console.error(reason);
    return { content, offset };
  }
  const sizes = await createSizes(paths);

  const base64 =
    options.placeholder === "blur"
      ? await getBase64(paths.inPath)
      : await getTrace(paths.inPath);

  const [{ start, end }] = getSrc(node);

  const withBase64 = insert(content, base64, start, end, offset);

  const withSrcset = insert(
    withBase64.content,
    getSrcset(sizes),
    end + 1,
    end + 2,
    withBase64.offset
  );

  const withRatio = insert(
    withSrcset.content,
    ` ratio=\'${(1 / (sizes[0].width / sizes[0].height)) * 100}%\' `,
    end + 1,
    end + 2,
    withSrcset.offset
  );

  if (!options.webp) return withRatio;

  return insert(
    withRatio.content,
    getSrcset(sizes, srcsetLineWebp, "srcsetWebp"),
    end + 1,
    end + 2,
    withRatio.offset
  );
}

async function optimize(paths) {
  const { size } = fs.statSync(paths.inPath);
  if (options.inlineBelow && size < options.inlineBelow) {
    return getBase64(paths.inPath, true);
  }

  ensureOutDirExists(paths.outDir);

  await sharp(paths.inPath)
    .jpeg({ quality: options.quality, progressive: false, force: false })
    .webp({ quality: options.quality, lossless: true, force: false })
    .png({ compressionLevel: options.compressionLevel, force: false })
    .toFile(paths.outPath);

  return paths.outUrl;
}

async function replaceInImg(edited, node, parentDir) {
  const { content, offset } = await edited;

  const { paths, willNotProcess } = await getProcessingPathsForNode(
    node,
    parentDir
  );
  if (willNotProcess) {
    return { content, offset };
  }

  const [{ start, end }] = getSrc(node);

  try {
    const outUri = await optimize(paths);
    return insert(content, outUri, start, end, offset);
  } catch (e) {
    console.error(e);
    return { content, offset };
  }
}

async function replaceImages(content, parentDir) {
  let ast;
  const imageNodes = [];
  const sourceDir = path.resolve(options.sourceDir);

  if (
    !new RegExp(`${sourceDir}[^node_modules]*`).test(parentDir) ||
    (!content.includes("<img") && !content.includes("<Image"))
  )
    return content;

  try {
    ast = svelte.parse(content);
  } catch (e) {
    console.error(e, "Error parsing component content");
  }

  svelte.walk(ast, {
    enter: (node) => {
      if (!["Element", "Fragment", "InlineComponent"].includes(node.type)) {
        return;
      }

      if (options.optimizeAll && node.name === "img") {
        imageNodes.push(node);
        return;
      }

      if (node.name !== options.tagName) return;
      imageNodes.push(node);
    },
  });

  if (!imageNodes.length) return content;

  const beforeProcessed = {
    content,
    offset: 0,
  };
  const processed = await imageNodes.reduce(async (edited, node) => {
    if (node.name === "img") {
      return replaceInImg(edited, node, parentDir);
    }
    return replaceInComponent(edited, node, parentDir);
  }, beforeProcessed);

  return processed.content;
}

/**
 * @param {Partial<typeof options>} options
 */
function getPreprocessor(opts = {}) {
  options = {
    ...options,
    ...opts,
  };

  return {
    markup: async ({ content, filename }) => ({
      code: await replaceImages(
        content,
        path.dirname(filename ? filename : "")
      ),
    }),
  };
}

module.exports = {
  defaults: options,
  replaceImages,
  getPreprocessor,
};
