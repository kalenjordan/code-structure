#!/usr/bin/env node

/**
 * Script to generate a tree structure of the directory and file hierarchy with method signatures
 *
 * Usage: node tree.js [directory] [options]
 *
 * Arguments:
 *   directory    Directory to scan (default: current project root)
 *
 * Options:
 *   --depth, -d   Maximum directory depth to scan (default: unlimited)
 *   --no-methods  Don't show methods under files
 *   --help, -h    Show help
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'acorn';
import { simple as walk } from 'acorn-walk';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '.');

// Parse command-line arguments
const args = process.argv.slice(2);
let maxDepth = Infinity;
let showHelp = false;
let showMethods = true;
let showAllMethods = false; // New flag for showing all methods vs just exported ones
let customRootDir = process.cwd(); // Default to current working directory
let positionalArgs = [];

// Process flags and collect positional arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg.startsWith('--') || arg.startsWith('-')) {
    // Handle flags
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
      break;
    } else if (arg === '--depth' || arg === '-d') {
      if (i + 1 < args.length) {
        maxDepth = parseInt(args[++i], 10);
        if (isNaN(maxDepth)) {
          console.error('Error: Depth must be a number');
          process.exit(1);
        }
      }
    } else if (arg === '--no-methods') {
      showMethods = false;
    } else if (arg === '--all-methods') {
      showAllMethods = true;
    }
  } else {
    // Collect positional arguments
    positionalArgs.push(arg);
  }
}

// Set directory from the first positional argument if provided
if (positionalArgs.length > 0) {
  customRootDir = positionalArgs[0];
  // If path is not absolute, make it relative to current directory
  if (!path.isAbsolute(customRootDir)) {
    customRootDir = path.resolve(process.cwd(), customRootDir);
  }
  if (!fs.existsSync(customRootDir)) {
    console.error(`Error: Directory ${customRootDir} does not exist`);
    process.exit(1);
  }
}

// Show help if requested
if (showHelp) {
  console.log(`
Usage: node tree.js [directory] [options]

Arguments:
  directory      Directory to scan (default: current working directory)

Options:
  --depth, -d     Maximum directory depth to scan (default: unlimited)
  --no-methods    Don't show methods under files
  --all-methods   Show all methods (default: only exported methods)
  --help, -h      Show help
`);
  process.exit(0);
}

// Default configuration (fallback if config file is not found)
const DEFAULT_CONFIG = {
  excludePaths: [
    'node_modules'  // This will exclude node_modules anywhere it appears
  ],
  excludeFiles: [
    'package-lock.json',
  ],
  includeExtensions: [
    '.js',
    '.mjs',
    '.cjs',
    '.json'
  ]
};

// Function to load configuration from JSON file
function loadConfig(scanDirectory) {
  const configPath = path.join(scanDirectory, '.code-structure.json');

  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);

      // Merge with defaults - additional exclusions are additive
      return {
        excludePaths: [...DEFAULT_CONFIG.excludePaths, ...(config.excludePaths || []), ...(config.excludeDirs || [])],
        excludeFiles: [...DEFAULT_CONFIG.excludeFiles, ...(config.excludeFiles || [])],
        includeExtensions: config.includeExtensions || DEFAULT_CONFIG.includeExtensions
      };
    }
  } catch (error) {
    console.warn(`Warning: Could not read config file ${configPath}: ${error.message}`);
    console.warn('Using default configuration.');
  }

  return {
    excludePaths: [...DEFAULT_CONFIG.excludePaths],
    excludeFiles: [...DEFAULT_CONFIG.excludeFiles],
    includeExtensions: [...DEFAULT_CONFIG.includeExtensions]
  };
}

// Function to extract method signatures from JS file (simplified version)
function extractMethodSignatures(filePath, includeAllMethods = false) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const signatures = [];
    const definedMethods = new Set();

    try {
      // Parse the JavaScript file
      const ast = parse(fileContent, {
        ecmaVersion: 2022,
        sourceType: 'module',
        locations: true,
      });

      // Walk the AST to find function declarations
      walk(ast, {
        FunctionDeclaration(node) {
          // Only include if we want all methods, or skip non-exported functions
          if (includeAllMethods && node.id && node.id.name) {
            const params = extractParams(node.params);
            const prefix = node.async ? 'async ' : '';
            signatures.push(`${prefix}${node.id.name}(${params})`);
          }
        },
        MethodDefinition(node) {
          // Only include class methods if we want all methods
          if (includeAllMethods) {
            const methodName = node.key.name || node.key.value;
            const params = extractParams(node.value.params);
            const prefix = node.value.async ? 'async ' : '';
            signatures.push(`${prefix}${methodName}(${params})`);
          }
        },
        VariableDeclarator(node) {
          // Only include variable function assignments if we want all methods
          if (includeAllMethods && node.id && node.id.name && node.init &&
             (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
            const params = extractParams(node.init.params);
            const prefix = node.init.async ? 'async ' : '';
            signatures.push(`${prefix}${node.id.name}(${params})`);
          }
        },
        ExportNamedDeclaration(node) {
          if (node.declaration && node.declaration.type === 'FunctionDeclaration') {
            const name = node.declaration.id.name;
            const params = extractParams(node.declaration.params);
            const prefix = node.declaration.async ? 'async ' : '';
            signatures.push(`export ${prefix}${name}(${params})`);
          } else if (node.declaration && node.declaration.type === 'VariableDeclaration') {
            // Handle export const myFunc = () => {}
            node.declaration.declarations.forEach(declarator => {
              if (declarator.init &&
                  (declarator.init.type === 'ArrowFunctionExpression' ||
                   declarator.init.type === 'FunctionExpression')) {
                const name = declarator.id.name;
                const params = extractParams(declarator.init.params);
                const prefix = declarator.init.async ? 'async ' : '';
                signatures.push(`export ${prefix}${name}(${params})`);
              }
            });
          }
        },
        ExportDefaultDeclaration(node) {
          if (node.declaration.type === 'FunctionDeclaration') {
            const name = node.declaration.id ? node.declaration.id.name : 'default';
            const params = extractParams(node.declaration.params);
            const prefix = node.declaration.async ? 'async ' : '';
            signatures.push(`export default ${prefix}${name}(${params})`);
          } else if (node.declaration.type === 'ArrowFunctionExpression' ||
                     node.declaration.type === 'FunctionExpression') {
            const params = extractParams(node.declaration.params);
            const prefix = node.declaration.async ? 'async ' : '';
            signatures.push(`export default ${prefix}function(${params})`);
          }
        }
      });

      return signatures;
    } catch (parseError) {
      // Fallback to regex-based extraction
      return extractMethodsFromRawContent(fileContent, includeAllMethods);
    }
  } catch (error) {
    return [];
  }
}

// Helper function to extract parameters
function extractParams(params) {
  return params.map(p => {
    if (p.type === 'Identifier') return p.name;
    if (p.type === 'AssignmentPattern') return `${p.left.name} = ...`;
    if (p.type === 'RestElement') return `...${p.argument.name}`;
    if (p.type === 'ObjectPattern') {
      if (p.properties && p.properties.length > 0) {
        const props = p.properties.map(prop => {
          if (prop.key && prop.key.name) {
            return prop.key.name;
          }
          return '?';
        });
        return `{${props.join(', ')}}`;
      }
      return '{...}';
    }
    if (p.type === 'ArrayPattern') return '[...]';
    return '?';
  }).join(', ');
}

// Fallback method extraction using regex
function extractMethodsFromRawContent(fileContent, includeAllMethods = false) {
  const methodSignatures = [];

  if (includeAllMethods) {
    // Match all function declarations
    const functionRegex = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
    let match;

    while ((match = functionRegex.exec(fileContent)) !== null) {
      const [fullMatch, name, params] = match;
      const isExported = fullMatch.includes('export');
      const prefix = isExported ? 'export ' : '';
      methodSignatures.push(`${prefix}${name}(${params})`);
    }

    // Match arrow functions
    const arrowRegex = /(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g;
    while ((match = arrowRegex.exec(fileContent)) !== null) {
      const [fullMatch, name, params] = match;
      const isExported = fullMatch.includes('export');
      const prefix = isExported ? 'export ' : '';
      methodSignatures.push(`${prefix}${name}(${params})`);
    }
  } else {
    // Only match exported functions
    const exportedFunctionRegex = /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
    let match;

    while ((match = exportedFunctionRegex.exec(fileContent)) !== null) {
      const [fullMatch, name, params] = match;
      const isDefault = fullMatch.includes('default');
      const isAsync = fullMatch.includes('async');
      const asyncPrefix = isAsync ? 'async ' : '';
      const exportPrefix = isDefault ? 'export default ' : 'export ';
      methodSignatures.push(`${exportPrefix}${asyncPrefix}${name}(${params})`);
    }

    // Match exported arrow functions and function expressions
    const exportedArrowRegex = /export\s+(?:default\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*=>/g;
    while ((match = exportedArrowRegex.exec(fileContent)) !== null) {
      const [fullMatch, name, asyncKeyword, params] = match;
      const isDefault = fullMatch.includes('default');
      const asyncPrefix = asyncKeyword ? 'async ' : '';
      const exportPrefix = isDefault ? 'export default ' : 'export ';
      methodSignatures.push(`${exportPrefix}${asyncPrefix}${name}(${params})`);
    }

    // Match export { functionName } patterns
    const exportListRegex = /export\s*\{\s*([^}]+)\s*\}/g;
    while ((match = exportListRegex.exec(fileContent)) !== null) {
      const exportList = match[1];
      const names = exportList.split(',').map(name => name.trim().split(/\s+as\s+/)[0].trim());

      // Try to find the function definitions for these exported names
      names.forEach(name => {
        const funcDefRegex = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(([^)]*)\\)|(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s+)?\\(([^)]*)\\)\\s*=>`, 'g');
        let funcMatch;
        while ((funcMatch = funcDefRegex.exec(fileContent)) !== null) {
          const params = funcMatch[1] || funcMatch[2] || '';
          const isAsync = funcMatch[0].includes('async');
          const asyncPrefix = isAsync ? 'async ' : '';
          methodSignatures.push(`export ${asyncPrefix}${name}(${params})`);
          break; // Only match the first occurrence
        }
      });
    }
  }

  return methodSignatures;
}

// Tree drawing characters
const TREE_CHARS = {
  VERTICAL: '│',
  HORIZONTAL: '─',
  JUNCTION: '├',
  CORNER: '└',
  SPACE: ' '
};

// Function to generate tree structure
function generateTree(dirPath, level = 0, relativePath = '', isLast = true, prefix = '') {
  const config = loadConfig(customRootDir);
  const EXCLUDE_PATHS = config.excludePaths;
  const EXCLUDE_FILES = config.excludeFiles;
  const INCLUDE_EXTENSIONS = config.includeExtensions;

  function shouldExcludePath(relativePath) {
    return EXCLUDE_PATHS.some(excludePath => {
      // Check if the path exactly matches the exclude pattern
      if (relativePath === excludePath) {
        return true;
      }

      // Check if the path starts with the exclude pattern (for subdirectories)
      if (relativePath.startsWith(`${excludePath}/`)) {
        return true;
      }

      // Check if the exclude pattern matches the directory name anywhere in the path
      const pathParts = relativePath.split('/');
      return pathParts.includes(excludePath);
    });
  }

  function shouldExcludeFile(filePath) {
    const fileName = path.basename(filePath);
    return EXCLUDE_FILES.includes(fileName);
  }

  // Check if we've reached the maximum depth
  if (level > maxDepth) {
    return '';
  }

  // Check if this directory path should be excluded
  if (level > 0 && shouldExcludePath(relativePath)) {
    return '';
  }

  let output = '';
  const items = fs.readdirSync(dirPath);

  // Separate files and directories
  const files = items
    .filter(item => {
      const itemPath = path.join(dirPath, item);
      return !fs.statSync(itemPath).isDirectory() &&
             !item.startsWith('.') &&
             !shouldExcludeFile(itemPath);
    })
    .sort();

  const dirs = items
    .filter(item => {
      const itemPath = path.join(dirPath, item);
      const itemRelativePath = path.join(relativePath, item);
      return fs.statSync(itemPath).isDirectory() &&
             !item.startsWith('.') &&
             !shouldExcludePath(itemRelativePath);
    })
    .sort();

  const allItems = [...dirs, ...files];

  // Process each item
  allItems.forEach((item, index) => {
    const itemPath = path.join(dirPath, item);
    const itemRelativePath = path.join(relativePath, item);
    const isLastItem = index === allItems.length - 1;
    const isDirectory = fs.statSync(itemPath).isDirectory();

    // Create the tree branch
    const branch = isLastItem ? TREE_CHARS.CORNER : TREE_CHARS.JUNCTION;
    const connector = TREE_CHARS.HORIZONTAL.repeat(2);

    // Output the item
    output += `${prefix}${branch}${connector} ${item}`;

    if (isDirectory) {
      output += '/\n';

      // Recurse into directory
      const newPrefix = prefix + (isLastItem ? '   ' : `${TREE_CHARS.VERTICAL}  `);
      output += generateTree(itemPath, level + 1, itemRelativePath, isLastItem, newPrefix);
    } else {
      // Show file size and line count
      try {
        const stats = fs.statSync(itemPath);
        const fileContent = fs.readFileSync(itemPath, 'utf8');
        const lineCount = fileContent.split('\n').length;
        output += ` (${lineCount} lines)\n`;

        // Show methods if requested and it's a supported file type
        if (showMethods) {
          const ext = path.extname(itemPath);
          if (INCLUDE_EXTENSIONS.includes(ext) && (ext === '.js' || ext === '.mjs' || ext === '.cjs')) {
            const methods = extractMethodSignatures(itemPath, showAllMethods);
            if (methods.length > 0) {
              const methodPrefix = prefix + (isLastItem ? '   ' : `${TREE_CHARS.VERTICAL}  `);
              methods.forEach((method, methodIndex) => {
                const isLastMethod = methodIndex === methods.length - 1;
                const methodBranch = isLastMethod ? TREE_CHARS.CORNER : TREE_CHARS.JUNCTION;
                output += `${methodPrefix}${methodBranch}${TREE_CHARS.HORIZONTAL} ${method}\n`;
              });
            }
          }
        }
      } catch (error) {
        output += ` (error reading file)\n`;
      }
    }
  });

  return output;
}

// Main execution
try {
  console.log(`Directory: ${customRootDir}`);
  console.log(`Maximum depth: ${maxDepth === Infinity ? 'unlimited' : maxDepth}`);
  console.log(`Show methods: ${showMethods ? 'yes' : 'no'}`);
  console.log('');

  // Start with the root directory name
  const rootName = path.basename(customRootDir);
  console.log(`${rootName}/`);

  // Generate and display the tree
  const tree = generateTree(customRootDir);
  console.log(tree);
} catch (error) {
  console.error('Error generating tree:', error);
  process.exit(1);
}
