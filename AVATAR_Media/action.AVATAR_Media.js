import {default as _helpers} from '../../ia/node_modules/ava-ia/helpers/index.js'

export default function (state) {
  return new Promise((resolve, reject) => {

     try {

  const stopWords = ["éteins", "coupe", "stop", "stoppe", "arrête", "arrete"];
  const stopMedia = stopWords.some(word => state.rawSentence.toLowerCase().includes(word));

    setTimeout(() => { 
      if (stopMedia) {
          state.action = {
            module: 'AVATAR_Media',
            command: 'stopMedia',
          };
         } else {
          if (state.debug) info('Action AVATAR_Media');
      state.action = {
        module: 'AVATAR_Media',
        command: state.rule,
      };
    };
      resolve(state);
    }, Config.waitAction.time);

     } catch (error) {
     reject(new Error(`Une erreur s'est produite lors du traitement de la commande AVATAR_Media: ${error.message}`));
    }

  });
}
  