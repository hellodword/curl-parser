{
  description = "Reproducible Nix builds and tests for curl-parser";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
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
          curlRev = "a05f34973e6c4bb629d018f7cb51487be1c904d8";
          curlTag = "curl-8_20_0";
          curlVersion = "8.20.0";
          python = pkgs.python3.withPackages (ps: [ ps.wasmtime ]);
          curlSource = pkgs.fetchFromGitHub {
            owner = "curl";
            repo = "curl";
            rev = curlRev;
            hash = "sha256-WjMDjF/SleliTCn1iD/X9fZ+9TQaV5o26vn0s1GEOw0=";
          };
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "curl-parser";
          version = "0.1.0";

          src = self;

          strictDeps = true;
          nativeBuildInputs = [
            pkgs.coreutils
            pkgs.nodejs
            pkgs.zig
            python
          ];

          postPatch = ''
            mkdir -p third_party/curl/${curlTag}/docs
            cp -R --no-preserve=mode,ownership ${curlSource}/src third_party/curl/${curlTag}/src
            cp -R --no-preserve=mode,ownership ${curlSource}/lib third_party/curl/${curlTag}/lib
            cp -R --no-preserve=mode,ownership ${curlSource}/include third_party/curl/${curlTag}/include
            cp -R --no-preserve=mode,ownership ${curlSource}/docs/cmdline-opts third_party/curl/${curlTag}/docs/cmdline-opts
            cp --no-preserve=mode,ownership ${curlSource}/COPYING third_party/curl/${curlTag}/COPYING
            cp --no-preserve=mode,ownership ${curlSource}/README.md third_party/curl/${curlTag}/README.md
            cat > third_party/curl/${curlTag}/manifest.json <<'JSON'
            {
              "tag": "${curlTag}",
              "upstreamRepository": "https://github.com/curl/curl",
              "upstreamCommit": "${curlRev}",
              "files": [],
              "licenseFiles": ["COPYING"]
            }
            JSON
          '';

          dontConfigure = true;

          buildPhase = ''
            runHook preBuild
            export HOME="$TMPDIR"
            export CC="zig cc"
            export WASM_CC="zig cc"
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
            python scripts/tasks.py lint
            python scripts/tasks.py test
            python scripts/tasks.py size --budget 110000
            runHook postCheck
          '';

          installPhase = ''
            runHook preInstall
            install -Dm755 build/native/curlparse_cli "$out/bin/curlparse_cli"
            install -Dm755 build/native/libcurlparse.so "$out/lib/libcurlparse.so"
            install -Dm644 dist/curl_parser.wasm "$out/share/curl-parser/dist/curl_parser.wasm"
            cp -R schemas wrappers "$out/share/curl-parser/"
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
          python = pkgs.python3.withPackages (ps: [ ps.wasmtime ]);
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.git
              pkgs.nodejs
              pkgs.zig
              python
            ];

            shellHook = ''
              export CC="zig cc"
              export WASM_CC="zig cc"
            '';
          };
        }
      );

      formatter = forAllSystems (system: (import nixpkgs { inherit system; }).nixfmt);
    };
}
