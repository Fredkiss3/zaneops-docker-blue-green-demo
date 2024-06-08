{ }:

let pkgs = import (fetchTarball "https://github.com/NixOS/nixpkgs/archive/bf744fe90419885eefced41b3e5ae442d732712d.tar.gz") { overlays = [ (import (builtins.fetchTarball "https://github.com/railwayapp/nix-npm-overlay/archive/main.tar.gz")) ]; };
in with pkgs;
  let
    APPEND_LIBRARY_PATH = "${lib.makeLibraryPath [ gcc-unwrapped ] }";
    myLibraries = writeText "libraries" ''
      export LD_LIBRARY_PATH="${APPEND_LIBRARY_PATH}:$LD_LIBRARY_PATH"
      
    '';
  in
    buildEnv {
      name = "bf744fe90419885eefced41b3e5ae442d732712d-env";
      paths = [
        (runCommand "bf744fe90419885eefced41b3e5ae442d732712d-env" { } ''
          mkdir -p $out/etc/profile.d
          cp ${myLibraries} $out/etc/profile.d/bf744fe90419885eefced41b3e5ae442d732712d-env.sh
        '')
        nodejs_18 pnpm-8_x
      ];
    }
