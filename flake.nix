{
  description = "Reproducible Nix builds and tests for curl-parser";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      curlSourceMetadata = builtins.fromJSON (builtins.readFile ./config/curl-source.json);
      systems = [
        "x86_64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;

      mkPackage =
        pkgs:
        {
          runTests ? false,
        }:
        let
          curlRev = curlSourceMetadata.upstreamCommit;
          curlTag = curlSourceMetadata.tag;
          curlVersion = curlSourceMetadata.version;
          python = pkgs.python3.withPackages (ps: [
            ps.pip
            ps.setuptools
            ps.wheel
          ]);
          curlSource = pkgs.fetchFromGitHub {
            owner = "curl";
            repo = "curl";
            rev = curlRev;
            hash = curlSourceMetadata.nixHash;
          };
          webPlaygroundNodeModules = pkgs.importNpmLock.buildNodeModules {
            npmRoot = self + /apps/web-playground;
            nodejs = pkgs.nodejs;
          };
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "curl-parser";
          version = "0.1.0";

          src = self;

          strictDeps = true;
          nativeBuildInputs = [
            pkgs.coreutils
            pkgs.git
            pkgs.importNpmLock.hooks.linkNodeModulesHook
            pkgs.nodejs
            pkgs.typescript
            pkgs.zig
            python
          ];

          postPatch = ''
            mkdir -p third_party/curl/${curlTag}/docs
            cp -R --no-preserve=mode,ownership ${curlSource}/src third_party/curl/${curlTag}/src
            cp -R --no-preserve=mode,ownership ${curlSource}/lib third_party/curl/${curlTag}/lib
            cp -R --no-preserve=mode,ownership ${curlSource}/include third_party/curl/${curlTag}/include
            cp -R --no-preserve=mode,ownership ${curlSource}/docs/cmdline-opts third_party/curl/${curlTag}/docs/cmdline-opts
            cp --no-preserve=mode,ownership ${curlSource}/${curlSourceMetadata.licenseFile} third_party/curl/${curlTag}/${curlSourceMetadata.licenseFile}
            cp --no-preserve=mode,ownership ${curlSource}/README.md third_party/curl/${curlTag}/README.md
            cat > third_party/curl/${curlTag}/manifest.json <<'JSON'
            {
              "tag": "${curlTag}",
              "upstreamRepository": "https://github.com/curl/curl",
              "upstreamCommit": "${curlRev}",
              "files": [],
              "licenseFiles": ["${curlSourceMetadata.licenseFile}"]
            }
            JSON
          '';

          dontConfigure = true;
          dontLinkNodeModules = true;
          npmRoot = "apps/web-playground";
          npmDeps = webPlaygroundNodeModules;

          buildPhase = ''
            runHook preBuild
            export HOME="$TMPDIR"
            export CC="zig cc"
            export WASM_CC="zig cc"
            export CURL_PARSER_SKIP_WEB_NPM_CI=1
            linkNodeModulesHook
            python scripts/tasks.py doctor
            python scripts/tasks.py generate
            python scripts/tasks.py build-native
            python scripts/tasks.py build-native-shared
            python scripts/tasks.py build-wasm
            runHook postBuild
          '';

          doCheck = runTests;
          checkPhase = ''
            runHook preCheck
            export HOME="$TMPDIR"
            export CC="zig cc"
            export WASM_CC="zig cc"
            export CURL_PARSER_SKIP_WEB_NPM_CI=1
            python scripts/tasks.py lint
            python scripts/tasks.py test
            python scripts/tasks.py size --budget ${toString curlSourceMetadata.wasmSizeBudget}
            runHook postCheck
          '';

          installPhase = ''
            runHook preInstall
            install -Dm755 build/native/curlparse_cli "$out/bin/curlparse_cli"
            install -Dm755 build/native/libcurlparse.so "$out/lib/libcurlparse.so"
            install -Dm644 dist/curl_parser.wasm "$out/share/curl-parser/dist/curl_parser.wasm"
            cp -R schemas "$out/share/curl-parser/"
            install -Dm644 README.md "$out/share/doc/curl-parser/README.md"
            install -Dm644 LICENSE "$out/share/doc/curl-parser/LICENSE"
            install -Dm644 THIRD_PARTY_NOTICES.md "$out/share/doc/curl-parser/THIRD_PARTY_NOTICES.md"
            runHook postInstall
          '';

          meta = {
            description = "Parse curl argv into structured JSON without network transfers";
            license = pkgs.lib.licenses.mit;
            mainProgram = "curlparse_cli";
            platforms = systems;
          };
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = mkPackage pkgs { };
          curl-parser = mkPackage pkgs { };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = mkPackage pkgs { runTests = true; };
        }
      );

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/curlparse_cli";
          meta.description = "Run curlparse_cli";
        };
      });

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          python = pkgs.python3.withPackages (ps: [
            ps.pip
            ps.setuptools
            ps.wheel
          ]);
          webPlaygroundNodeModules = pkgs.importNpmLock.buildNodeModules {
            npmRoot = self + /apps/web-playground;
            nodejs = pkgs.nodejs;
          };
        in
        {
          default = pkgs.mkShell {
            npmRoot = "apps/web-playground";
            npmDeps = webPlaygroundNodeModules;
            packages = [
              pkgs.cargo
              pkgs.git
              pkgs.go
              pkgs.importNpmLock.hooks.linkNodeModulesHook
              pkgs.nodejs
              pkgs.typescript
              pkgs.rustc
              pkgs.zig
              python
            ];

            shellHook = ''
              export CC="zig cc"
              export WASM_CC="zig cc"
              export CURL_PARSER_SKIP_WEB_NPM_CI=1
              linkNodeModulesHook
            '';
          };
        }
      );

      formatter = forAllSystems (system: (import nixpkgs { inherit system; }).nixfmt);
    };
}
