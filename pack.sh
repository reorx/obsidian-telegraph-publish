#!/bin/bash

dist_dir="$PWD/dist"
build_dir="$PWD/build"
package_name="obsidian-telegraph-publish"
manifest_path="manifest.json"

version=$(grep '"version' "$manifest_path" | grep -Eo '\d.\d.\d')
if [ -z "$version" ]; then
    echo "cannot get version"
    exit 1
fi
dirname="${package_name}-$version"
filename="${dirname}.zip"

tmpdir=$(mktemp -d)
cp -r "$build_dir" "$tmpdir/$dirname"
pushd "$tmpdir"
zip $filename * -vr
mkdir -p "$dist_dir"
mv $filename "$dist_dir"
popd

echo "Result:"
ls -l "$dist_dir/$filename"
