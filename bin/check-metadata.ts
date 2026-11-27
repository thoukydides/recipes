// Thouky's Recipes
// Copyright © 2026 Alexander Thoukydides

import { Parser, ScaledRecipeWithReport } from '@cooklang/cooklang';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Images implicitly associated with a recipe
interface RecipeImages {
    recipe?:    string;
    steps:      Map<number, string>;
}
interface RecipeWithImages extends ScaledRecipeWithReport {
    images: RecipeImages;
}

// Recursively search for and parse cooklang files from the current directory
const parser = new Parser();
const recipes = new Map<string, RecipeWithImages>();
getCookFiles('.', parser, recipes);
console.log(`${recipes.size} recipes`);

// Count tag usage across all recipes
const tagCounts = new Map<string, number>();
for (const [_recipePath, recipe] of recipes) {
    const tags = recipe.metadata.tags ?? [];
    for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
}
const tags = [...tagCounts].sort((a, b) => b[1] - a[1]).map(([tag, count]) => `${tag} (${count})`);
console.log(`Tag usage: ${tags.join(', ')}`);

// Check each recipe
const problemCounts = new Map<string, number>();
for (const [recipePath, recipe] of recipes) {
    const problems: (string | [string, string[]])[] = [];
    const { metadata } = recipe;

    // Every recipe should have a description, cuisine, and timings
    if (!metadata.description?.length)                      problems.push('Missing "description"');
    if (!metadata.cuisine)                                  problems.push('Missing "cuisine"');
    if (!metadata.time)                                     problems.push('Missing "prep time"/"cook time"');

    // Every recipe should have either an implicit or explicit image
    if (!metadata.images && !recipe.images.recipe)          problems.push('Missing recipe image');
    if (metadata.images && recipe.images.recipe)            problems.push('Image URL specified with local image');

    // If there is a source then there should be an author too
    if (!metadata.source)                                   problems.push('Missing "source"');
    if (metadata.source && !metadata.author)                problems.push('Missing "author"');

    // All tags should be kebab-case (all lowercase, no spaces or other punctuation)
    const tags = recipe.metadata.tags ?? [];
    const badTags = tags.filter(tag => tag !== toKebabCase(tag));
    if (badTags.length)                                     problems.push(['Tags not in kebab-case', badTags]);

    // Tags should include any cuisine or diet (converted to lowercase)
    if (typeof metadata.cuisine === 'string') {
        const cuisineTag = toKebabCase(metadata.cuisine);
        if (!tags.includes(cuisineTag))                     problems.push(['Tags missing cuisine', [cuisineTag]]);
    }
    if (typeof metadata.diet === 'string') {
        const dietTag = toKebabCase(metadata.diet);
        if (!tags.includes(dietTag))                        problems.push(['Tags missing diet', [dietTag]]);
    }

    // Tags should include all path components (converted to lowercase)
    const pathTags = path.dirname(recipePath).split('/').map(tag => toKebabCase(tag)).filter(Boolean);
    const missingPathTags = pathTags.filter(tag => !tags.includes(tag));
    if (missingPathTags.length)                             problems.push(['Tags missing path component', missingPathTags]);

    // There should not be any non-standard metadata
    const custom = Object.keys(metadata.custom).sort();
    if (custom.length)                                      problems.push(['Non-standard metadata', custom]);

    // Check that references to other recipes are valid
    const brokenIngredients: string[] = [];
    for (const ingredient of recipe.recipe.ingredients) {
        if (ingredient.reference) {
            const { components, name } = ingredient.reference;
            const ingredientPath = path.join(...components, `${name}.cook`);
            if (!recipes.has(ingredientPath)) brokenIngredients.push(ingredientPath);
        }
    }
    if (brokenIngredients.length)                           problems.push(['Broken recipe reference', brokenIngredients]);

    // Report all problems found
    if (problems.length) {
        console.warn(`${recipePath}:`);
        for (const problem of problems) {
            const [type, values] = typeof problem === 'string' ? [problem] : problem;
            console.warn(`    ${type}${values?.length ? `: ${values.sort().join(', ')}` : ''}`);
            problemCounts.set(type, (problemCounts.get(type) ?? 0) + 1);
        }
        console.warn('');
    }
}

// Summarise the problems
if (problemCounts.size) {
    console.log('Problems found:');
    const problems = [...problemCounts].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [problem, count] of problems) console.log(`    ${problem} (${count})`);
} else {
    console.log('No problems found');
}

// Recursively search for and parse cooklang files
function getCookFiles(dir: string, parser: Parser, recipes: Map<string, RecipeWithImages>): void {
    const dirEntries = readdirSync(dir, { withFileTypes: true });

    // First pass finds and parses recipes
    for (const dirEntry of dirEntries) {
        if (dirEntry.isDirectory()) {
            if (!dirEntry.name.startsWith('.')) {
                // Non-hidden subdirectory
                getCookFiles(path.join(dir, dirEntry.name), parser, recipes);
            }
        } else if (dirEntry.isFile()) {
            if (dirEntry.name.endsWith('.cook')) {
                // Recipe file (<xxx>.cook)
                const recipePath = path.join(dirEntry.parentPath, dirEntry.name);
                const recipeText = readFileSync(recipePath, 'utf-8');
                const recipe = parser.parse(recipeText);
                recipes.set(recipePath, { ...recipe, images: { steps: new Map()} });
            }
        }
    }

    // Second pass finds images that match recipe filenames
    for (const dirEntry of dirEntries) {
        if (dirEntry.isFile()) {
            const match = /^(.+?)(?:\.(\d+))?\.(?:jpg|png)$/.exec(dirEntry.name);
            if (match) {
                // Image file
                const [, name, step] = match;
                const imagePath  = path.join(dir, dirEntry.name);
                const recipePath = path.join(dir, `${name}.cook`);
                const recipe = recipes.get(recipePath);
                if (!recipe) {
                    console.warn(`Stray image file: ${imagePath}`);
                } else {
                    if (step)   recipe.images.steps.set(parseInt(step, 10), imagePath);
                    else        recipe.images.recipe = imagePath;
                }
            }
        }
    }
}

// Convert a string to kebab-case
function toKebabCase(str: string): string {
    return str.toLocaleLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replace(/^-+/, '').replace(/-+$/, '');
}