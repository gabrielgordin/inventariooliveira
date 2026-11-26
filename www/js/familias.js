/* Família botânica pelo gênero (APG IV, nomes como na Flora e Funga do Brasil).
   Vale para as espécies da base e para as que o usuário cadastrar: basta o nome científico começar pelo gênero. */
(function (root) {
  'use strict';
  const F = {
    Anacardiaceae: 'Anacardium Astronium Lithrea Myracrodruon Schinus Spondias Tapirira',
    Annonaceae: 'Annona Cardiopetalum Duguetia Ephedranthus Guatteria Rollinia Unonopsis Xylopia',
    Apocynaceae: 'Aspidosperma Hancornia Himatanthus Tabernaemontana',
    Aquifoliaceae: 'Ilex',
    Araliaceae: 'Dendropanax Didymopanax Schefflera',
    Arecaceae: 'Acrocomia Allagoptera Attalea Butia Euterpe Mauritia Orbignya Scheelea Syagrus',
    Asteraceae: 'Baccharis Eremanthus Moquiniastrum Piptocarpha Vernonanthura Gochnatia',
    Bignoniaceae: 'Cybistax Handroanthus Jacaranda Sparattosperma Tabebuia Zeyheria',
    Boraginaceae: 'Cordia Varronia',
    Burseraceae: 'Protium',
    Calophyllaceae: 'Calophyllum Kielmeyera',
    Cannabaceae: 'Celtis Trema',
    Caryocaraceae: 'Caryocar',
    Celastraceae: 'Maytenus Monteverdia Plenckia Salacia',
    Chrysobalanaceae: 'Couepia Hirtella Licania Moquilea Parinari',
    Clusiaceae: 'Clusia Garcinia',
    Combretaceae: 'Buchenavia Combretum Terminalia',
    Connaraceae: 'Connarus Rourea',
    Dilleniaceae: 'Curatella Davilla',
    Ebenaceae: 'Diospyros',
    Erythroxylaceae: 'Erythroxylum',
    Euphorbiaceae: 'Alchornea Croton Euphorbia Mabea Manihot Maprounea Sapium',
    Fabaceae: 'Acacia Acosmium Albizia Amburana Anadenanthera Andira Apuleia Bauhinia Bowdichia Calliandra Cassia Chamaecrista Copaifera Dalbergia Dimorphandra Diptychandra Dipteryx Enterolobium Erythrina Hymenaea Hymenolobium Inga Leptolobium Leucochloron Lonchocarpus Luetzelburgia Machaerium Martiodendron Mimosa Myroxylon Ormosia Paubrasilia Peltophorum Piptadenia Plathymenia Platypodium Pseudopiptadenia Pterocarpus Pterodon Sclerolobium Senegalia Senna Stryphnodendron Swartzia Sweetia Tachigali Vatairea Vataireopsis',
    Hypericaceae: 'Vismia',
    Lamiaceae: 'Aegiphila Hyptidendron Vitex',
    Lauraceae: 'Aniba Cryptocarya Nectandra Ocotea Persea',
    Lecythidaceae: 'Cariniana Lecythis',
    Loganiaceae: 'Antonia Strychnos',
    Lythraceae: 'Lafoensia Physocalymma',
    Malpighiaceae: 'Banisteriopsis Byrsonima Heteropterys',
    Malvaceae: 'Apeiba Ceiba Eriotheca Guazuma Helicteres Luehea Pseudobombax Sterculia',
    Melastomataceae: 'Miconia Mouriri Pleroma Tibouchina',
    Meliaceae: 'Cabralea Cedrela Guarea Trichilia',
    Metteniusaceae: 'Emmotum',
    Moraceae: 'Brosimum Ficus Maclura Sorocea',
    Myristicaceae: 'Virola',
    Myrtaceae: 'Blepharocalyx Campomanesia Eugenia Myrcia Myrciaria Plinia Psidium',
    Nyctaginaceae: 'Guapira Neea',
    Ochnaceae: 'Ouratea',
    Opiliaceae: 'Agonandra',
    Peraceae: 'Pera',
    Picramniaceae: 'Picramnia Picrania',
    Polygonaceae: 'Coccoloba Triplaris',
    Primulaceae: 'Myrsine Rapanea',
    Proteaceae: 'Roupala',
    Rhamnaceae: 'Colubrina Rhamnidium',
    Rubiaceae: 'Alibertia Chomelia Cordiera Ferdinandusa Genipa Guettarda Palicourea Randia Rudgea Tocoyena',
    Rutaceae: 'Esenbeckia Metrodorea Zanthoxylum',
    Salicaceae: 'Casearia Xylosma',
    Sapindaceae: 'Allophylus Cupania Dilodendron Magonia Matayba Talisia',
    Sapotaceae: 'Chrysophyllum Micropholis Pouteria Sideroxylon',
    Simaroubaceae: 'Simarouba',
    Siparunaceae: 'Siparuna',
    Solanaceae: 'Solanum',
    Styracaceae: 'Styrax',
    Urticaceae: 'Cecropia',
    Vochysiaceae: 'Callisthene Qualea Salvertia Vochysia'
  };
  const G = {};
  Object.entries(F).forEach(([fam, gs]) => gs.split(/\s+/).forEach(g => { G[g.toLowerCase()] = fam; }));
  // família a partir do nome científico ("Qualea grandiflora", "Myrcia sp.", "Hymenaea (conferir)")
  function de(cientifico) {
    const g = String(cientifico || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0].toLowerCase();
    // gênero fora da tabela: usa a família que o anexo da Portaria GM/MMA 1.783/2026 dá para ele
    return G[g] || (root.AMEACADAS && root.AMEACADAS.familiaDoGenero[g]) || '';
  }
  root.Familias = { de, lista: F };
  if (typeof module !== 'undefined') module.exports = root.Familias;
})(typeof window !== 'undefined' ? window : globalThis);
